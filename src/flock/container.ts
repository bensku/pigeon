import * as pulumi from '@pulumi/pulumi';
import stringify from 'json-stable-stringify';
import * as oci from '../oci';
import { Endpoint, EndpointArgs } from './endpoint';
import { composeConfig } from './nebula-config';

export interface PodAttachmentArgs {
  /**
   * Endpoint to attach to a pod.
   */
  endpoint: Endpoint;

  /**
   * Pod to attach the endpoint to.
   */
  pod: oci.Pod;

  lighthouse?: boolean;
  underlayPort?: pulumi.Output<number>;
}

export class PodAttachment extends pulumi.ComponentResource {
  readonly endpoint: Endpoint;
  readonly underlayPort: pulumi.Output<number>;

  constructor(
    name: string,
    args: PodAttachmentArgs,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super('pigeon:flock:PodAttachment', name, args, opts);
    this.endpoint = args.endpoint;
    this.underlayPort = args.underlayPort ?? pulumi.output(0);

    // Generate Nebula configuration and upload it to host
    const config = new oci.LocalFile(
      `${name}-nebula-config`,
      {
        pod: args.pod,
        source: composeConfig(this.endpoint, {
          isLighthouse: args.lighthouse ?? false,
          underlayPort: this.underlayPort,
        }).apply((cfg) => new pulumi.asset.StringAsset(stringify(cfg)!)),
      },
      {
        parent: this,
      },
    );

    // Launch Nebula container in pod given to us
    new oci.Container(
      `${name}-nebula-container`,
      {
        pod: args.pod,
        image: 'docker.io/nebulaoss/nebula:1.9.5', // TODO don't hardcode
        name: pulumi.interpolate`nebula-${args.endpoint.network.networkId}`,
        networkMode: args.lighthouse ? 'host' : 'pod',
        mounts: [[config, '/config/config.yml']], // It is actually JSON, but this is the expected path
        linuxCapabilities: ['NET_ADMIN'],
        linuxDevices: ['/dev/net/tun'],
      },
      {
        parent: this,
      },
    );
  }
}
