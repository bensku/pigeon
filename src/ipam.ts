import * as pulumi from '@pulumi/pulumi';
import * as command from '@pulumi/command';
import * as random from '@pulumi/random';
import * as host from './host';

interface IpamHostArgs {
  host: host.Host;
}

export class IpamHost extends pulumi.ComponentResource {
  #connection: command.remote.CommandArgs['connection'];

  constructor(
    name: string,
    args: IpamHostArgs,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super('pigeon:ipam:IpamHost', name, args, opts);
    this.#connection = args.host.connection;

    // Install mini-ipam on machine
    const copy = new host.FileUpload(
      `${name}-copy`,
      {
        host: args.host,
        source: new pulumi.asset.FileAsset('mini-ipam/mini-ipam'),
        remotePath: '/opt/pigeon/mini-ipam',
      },
      { parent: this, dependsOn: args.host },
    );

    // Make the executable executable and create config dir if needed
    new command.remote.Command(
      `${name}-commands`,
      {
        connection: this.#connection,
        create: 'chmod +x /opt/pigeon/mini-ipam && mkdir -p /etc/pigeon/ipam',
      },
      { parent: this, dependsOn: copy },
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
        connection: this.#connection,
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
        connection: this.#connection,
        create: pulumi.interpolate`cd /etc/pigeon/ipam && /opt/pigeon/mini-ipam allocate-address "${network.networkId}" "${id}"`,
        delete: pulumi.interpolate`cd /etc/pigeon/ipam && /opt/pigeon/mini-ipam free-address "${network.networkId}" "${id}" || true`,
        addPreviousOutputInEnv: false,
      },
      { dependsOn: [this, network], parent },
    );
    return cmd.stdout;
  }
}

interface NetworkArgs {
  ipamHost: IpamHost;
  cidr: string;
}

export class Network extends pulumi.ComponentResource {
  ipamHost: IpamHost;
  networkId: pulumi.Output<string>;

  constructor(
    name: string,
    args: NetworkArgs,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super('pigeon:ipam:Network', name, {}, opts);
    this.ipamHost = args.ipamHost;
    const randomId = new random.RandomUuid(`${name}-id`, {}, { parent: this });
    this.networkId = pulumi.interpolate`${name}-${randomId.result}`;

    args.ipamHost.createNetwork(this, name, this.networkId, args.cidr);
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
