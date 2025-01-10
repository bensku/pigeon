import * as pulumi from '@pulumi/pulumi';

export interface FlockArgs {}

export class Network extends pulumi.ComponentResource {
  constructor(
    name: string,
    args: FlockArgs,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super('pigeon:flock:Network', name, {}, opts);
  }
}
