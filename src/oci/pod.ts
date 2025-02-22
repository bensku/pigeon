import * as pulumi from '@pulumi/pulumi';
import * as host from '../host';
import * as systemd from '../systemd';
import { Container } from './container';
import { PodNetworkProvider } from './network';
import { DnsContainer } from './dns';

export interface PodNetwork<T extends { hostname: pulumi.Input<string> }> {
  network: PodNetworkProvider<T>;
  endpoint: T;
}

export interface PodArgs {
  host: host.Host;

  name: string;
  networks?: PodNetwork<any>[];
  ports?: [pulumi.Input<number>, pulumi.Input<number>, ('tcp' | 'udp')?][];
}

export class Pod extends pulumi.ComponentResource {
  readonly name: string;
  readonly host: host.Host;
  readonly podName: pulumi.Output<string>;
  readonly ports: [
    pulumi.Input<number>,
    pulumi.Input<number>,
    ('tcp' | 'udp')?,
  ][];

  readonly podNetName: pulumi.Output<string>;
  readonly podNetService: pulumi.Output<string>;

  readonly containers: Container[] = [];

  constructor(
    name: string,
    args: PodArgs,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super('pigeon:oci:Pod', name, args, opts);
    this.name = name;
    this.host = args.host;
    this.podName = pulumi.output(args.name);
    this.ports = args.ports ?? [];

    // Ensure container runtime is installed before we proceed any further
    const runtimeInstall = this.host.installPackage('podman', {
      parent: this,
      dependsOn: args.host,
    });

    // Create local DNS container that also serves as pod's network
    const dns = new DnsContainer(
      `${name}-dns`,
      {
        pod: this,
        networks: args.networks ?? [],
      },
      { parent: this, dependsOn: runtimeInstall },
    );
    this.podNetName = dns.networkName;
    this.podNetService = dns.serviceName;

    // Attach networks to pod
    for (const network of args.networks ?? []) {
      network.network.attachPod(this, network.endpoint);
    }
  }
}
