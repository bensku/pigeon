import * as pulumi from '@pulumi/pulumi';
import * as host from '../host';
import * as ipam from '../ipam';
import { Network } from './network';

export interface EnrollArgs {
  host: host.Host;

  network: Network;
}

export class Enrollment extends pulumi.ComponentResource {
  readonly hostNode: host.Host;

  constructor(
    name: string,
    args: EnrollArgs,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super('pigeon:flock:Host', name, args, opts);
    this.hostNode = args.host;
  }
}
