import * as pulumi from '@pulumi/pulumi';
import * as ssh from '../ssh';
import { Pod, PodNetwork } from './pod';
import { containerSshActions } from './container';

export interface DnsContainerArgs {
  pod: Pod;
  networks: PodNetwork<any>[];
}

export class DnsContainer {
  readonly networkName: pulumi.Output<string>;
  readonly serviceName: pulumi.Output<string>;

  constructor(
    name: string,
    args: DnsContainerArgs,
    opts?: pulumi.ComponentResourceOptions,
  ) {
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

    const configPath = pulumi.interpolate`/var/pigeon/oci-uploads/${args.pod.podName}-dnsmasq.conf`;
    new ssh.RunActions(
      `${name}-service`,
      {
        connection: args.pod.host.connection,
        actions: [
          {
            type: 'upload',
            source: config,
            remotePath: configPath,
          },
          ...containerSshActions({
            pod: args.pod,
            name: 'dnsmasq',
            image: 'ghcr.io/bensku/pigeon/dnsmasq', // TODO use specific tag
            podDns: '127.0.0.1',
            networkMode: 'bridge',
            mounts: [[configPath, '/etc/dnsmasq.conf']],
            // This container serves as pod network, so pod's ports are its ports!
            bridgePorts: args.pod.ports,
          }),
        ],
      },
      { ...opts, deleteBeforeReplace: true },
    );

    this.networkName = pulumi.interpolate`container:${args.pod.podName}-dnsmasq`;
    this.serviceName = pulumi.interpolate`${args.pod.podName}-dnsmasq`;
  }
}
