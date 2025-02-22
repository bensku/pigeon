import * as pulumi from '@pulumi/pulumi';
import { Pod, PodNetwork } from './pod';
import { Container } from './container';
import { LocalFile } from './volume';

export interface DnsContainerArgs {
  pod: Pod;
  networks: PodNetwork<any>[];
}

export class DnsContainer extends pulumi.ComponentResource {
  readonly networkName: pulumi.Output<string>;
  readonly serviceName: pulumi.Output<string>;

  constructor(
    name: string,
    args: DnsContainerArgs,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super('pigeon:oci:DnsContainer', name, args, opts);

    const config = pulumi.interpolate`# Provide DNS to this pod only
bind-interfaces
interface=lo
no-dhcp-interface=lo

# This pods names -> loopback
${pulumi.concat(...args.networks.map((network) => pulumi.interpolate`address=/${network.endpoint.hostname}.${network.network.dnsDomain}/127.0.0.1\n`))}

# DNS servers for pod networks
${pulumi.concat(
  ...args.networks.map((network) =>
    pulumi.concat(
      ...network.network
        .dnsServers(args.pod)
        .map(
          (server) =>
            pulumi.interpolate`server=/${network.network.dnsDomain}/${server}\n`,
        ),
    ),
  ),
)}

# Fallback to public DNS
# TODO configurable
no-hosts
no-resolv
server=8.8.8.8
`;
    const configFile = new LocalFile(
      `${name}-config`,
      {
        pod: args.pod,
        source: config.apply((cfg) => new pulumi.asset.StringAsset(cfg)),
      },
      { parent: this },
    );

    const container = new Container(
      name,
      {
        pod: args.pod,
        name: 'dnsmasq',
        image: 'ghcr.io/bensku/pigeon/dnsmasq', // TODO use specific tag
        podDns: '127.0.0.1',
        disablePodNetwork: true,
        mounts: [[configFile, '/etc/dnsmasq.conf']],
        // This container serves as pod network, so pod's ports are its ports!
        directPorts: args.pod.ports,
      },
      { parent: this },
    );
    this.networkName = pulumi.interpolate`container:${container.containerName}`;
    this.serviceName = container.serviceName;
  }
}
