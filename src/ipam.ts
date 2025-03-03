import * as pulumi from '@pulumi/pulumi';
import * as command from '@pulumi/command';
import * as random from '@pulumi/random';
import * as host from './host';
import * as ssh from './ssh';
import { connectSSH } from './ssh';

interface IpamHostArgs {
  host: host.Host;
}

export class IpamHost extends pulumi.ComponentResource {
  readonly connection: command.remote.CommandArgs['connection'];

  constructor(
    name: string,
    args: IpamHostArgs,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super('pigeon:ipam:IpamHost', name, args, opts);
    this.connection = args.host.connection;

    // Install mini-ipam on target machine
    new ssh.RunActions(
      `${name}-setup`,
      {
        connection: args.host.connection,
        actions: [
          {
            type: 'upload',
            source: { localPath: 'mini-ipam/mini-ipam' },
            remotePath: '/opt/pigeon/mini-ipam',
          },
          {
            type: 'command',
            create:
              'chmod +x /opt/pigeon/mini-ipam && mkdir -p /etc/pigeon/ipam',
          },
        ],
      },
      { parent: this, dependsOn: args.host, deleteBeforeReplace: true },
    );
  }

  createNetwork(
    parent: pulumi.Resource,
    name: string,
    networkId: pulumi.Input<string>,
    cidr: pulumi.Input<string>,
  ) {
    new command.remote.Command(
      `ipam-net-${name}`,
      {
        connection: this.connection,
        create: pulumi.interpolate`cd /etc/pigeon/ipam && /opt/pigeon/mini-ipam create-network "${networkId}" "${cidr}"`,
        delete: pulumi.interpolate`cd /etc/pigeon/ipam && /opt/pigeon/mini-ipam destroy-network "${networkId}"`,
        addPreviousOutputInEnv: false,
      },
      { dependsOn: this, parent },
    );
  }

  allocateAddress(
    parent: pulumi.Resource,
    network: Network,
    name: string,
    id: pulumi.Input<string>,
  ): pulumi.Output<string> {
    const cmd = new command.remote.Command(
      `ipam-ip-${name}`,
      {
        connection: this.connection,
        create: pulumi.interpolate`cd /etc/pigeon/ipam && /opt/pigeon/mini-ipam allocate-address "${network.networkId}" "${id}"`,
        delete: pulumi.interpolate`cd /etc/pigeon/ipam && /opt/pigeon/mini-ipam free-address "${network.networkId}" "${id}" || true`,
        addPreviousOutputInEnv: false,
      },
      { dependsOn: [this, network], parent },
    );
    return cmd.stdout;
  }

  createHost(
    parent: pulumi.Resource,
    name: string,
    hostId: pulumi.Input<string>,
    startPort: pulumi.Input<number>,
    endPort: pulumi.Input<number>,
  ) {
    new command.remote.Command(
      `ipam-host-${name}`,
      {
        connection: this.connection,
        create: pulumi.interpolate`cd /etc/pigeon/ipam && /opt/pigeon/mini-ipam create-host "${hostId}" ${startPort} ${endPort}`,
        delete: pulumi.interpolate`cd /etc/pigeon/ipam && /opt/pigeon/mini-ipam delete-host "${hostId}"`,
        addPreviousOutputInEnv: false,
      },
      { dependsOn: this, parent },
    );
  }

  allocatePort(
    parent: pulumi.Resource,
    name: string,
    host: PortHost,
    portId: pulumi.Input<string>,
  ) {
    const cmd = new command.remote.Command(
      `ipam-host-${name}`,
      {
        connection: this.connection,
        create: pulumi.interpolate`cd /etc/pigeon/ipam && /opt/pigeon/mini-ipam allocate-port "${host.hostId}" "${portId}"`,
        delete: pulumi.interpolate`cd /etc/pigeon/ipam && /opt/pigeon/mini-ipam free-port "${host.hostId}" "${portId}"`,
        addPreviousOutputInEnv: false,
      },
      { dependsOn: [this, host], parent },
    );
    return cmd.stdout.apply((port) => parseInt(port, 10));
  }
}

interface NetworkArgs {
  ipamHost: IpamHost;
  cidr: string;
  networkId: pulumi.Input<string>;
}

export class Network extends pulumi.ComponentResource {
  ipamHost: IpamHost;
  networkId: pulumi.Output<string>;
  prefixLength: number;

  constructor(
    name: string,
    args: NetworkArgs,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super('pigeon:ipam:Network', name, {}, opts);
    this.ipamHost = args.ipamHost;
    this.networkId = pulumi.output(args.networkId);

    args.ipamHost.createNetwork(this, name, this.networkId, args.cidr);
    this.prefixLength = parseInt(args.cidr.split('/')[1], 10);
  }
}

interface IpAddressArgs {
  network: Network;
}

export class IpAddress extends pulumi.ComponentResource {
  addressId: pulumi.Output<string>;
  address: pulumi.Output<string>;

  constructor(
    name: string,
    args: IpAddressArgs,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super('pigeon:ipam:IpAddress', name, {}, opts);
    const randomId = new random.RandomUuid(`${name}-id`, {}, { parent: this });
    this.addressId = pulumi.interpolate`${name}-${randomId.result}`;

    this.address = args.network.ipamHost.allocateAddress(
      this,
      args.network,
      name,
      this.addressId,
    );
  }
}

export interface PortHostArgs {
  ipamHost: IpamHost;
  startPort: pulumi.Input<number>;
  endPort: pulumi.Input<number>;
}

export class PortHost extends pulumi.ComponentResource {
  ipamHost: IpamHost;
  hostId: pulumi.Output<string>;

  constructor(
    name: string,
    args: PortHostArgs,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super('pigeon:ipam:PortHost', name, args, opts);
    this.ipamHost = args.ipamHost;
    const randomId = new random.RandomUuid(`${name}-id`, {}, { parent: this });
    this.hostId = pulumi.interpolate`${name}-${randomId.result}`;

    args.ipamHost.createHost(
      this,
      name,
      this.hostId,
      args.startPort,
      args.endPort,
    );
  }
}

export interface PortAllocationArgs {
  host: PortHost;
}

export class PortAllocation extends pulumi.ComponentResource {
  readonly portId: pulumi.Output<string>;
  readonly port: pulumi.Output<number>;

  constructor(
    name: string,
    args: PortAllocationArgs,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super('pigeon:ipam:PortAllocation', name, {}, opts);
    const randomId = new random.RandomUuid(`${name}-id`, {}, { parent: this });
    this.portId = pulumi.interpolate`${name}-${randomId.result}`;

    this.port = args.host.ipamHost.allocatePort(
      this,
      name,
      args.host,
      this.portId,
    );
  }
}

export async function allocateAddressManual(
  connection: pulumi.Unwrap<command.remote.CommandArgs['connection']>,
  networkId: string,
  addressId: string,
) {
  const ssh = await connectSSH(connection);
  const result = await ssh.execCommand(
    `cd /etc/pigeon/ipam && /opt/pigeon/mini-ipam allocate-address "${networkId}" "${addressId}"`,
  );
  if (result.code != 0) {
    throw new Error(result.stderr);
  }
  return result.stdout;
}

export async function freeAddressManual(
  connection: pulumi.Unwrap<command.remote.CommandArgs['connection']>,
  networkId: string,
  addressId: string,
) {
  const ssh = await connectSSH(connection);
  const result = await ssh.execCommand(
    `cd /etc/pigeon/ipam && /opt/pigeon/mini-ipam free-address "${networkId}" "${addressId}" || true`,
  );
  if (result.code != 0) {
    throw new Error(result.stderr);
  }
  return result.stdout;
}
