import * as pulumi from '@pulumi/pulumi';
import * as host from '../host';
import * as ipam from '../ipam';
import { Network } from './network';

export interface EnrollArgs {
  host: host.Host;

  network: Network;

  /**
   * Range of ports that Flock network system is allowed to use. Each
   * endpoint, including lighthouses, requires one port.
   *
   * Inclusive, exclusive.
   */
  portRange: [number, number];
}

export class Enrollment extends pulumi.ComponentResource {
  readonly hostNode: host.Host;
  readonly portHost: ipam.PortHost;

  constructor(
    name: string,
    args: EnrollArgs,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super('pigeon:flock:Host', name, args, opts);
    this.hostNode = args.host;

    this.portHost = new ipam.PortHost(
      `${name}-ports`,
      {
        ipamHost: args.network.ipam.ipamHost,
        startPort: args.portRange[0],
        endPort: args.portRange[1],
      },
      {
        parent: this,
      },
    );
  }
}
