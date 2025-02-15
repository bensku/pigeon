import * as pulumi from '@pulumi/pulumi';
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
}

export class PodAttachment extends pulumi.ComponentResource {
  readonly endpoint: Endpoint;

  constructor(
    name: string,
    args: PodAttachmentArgs,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super('pigeon:flock:PodAttachment', name, args, opts);
    this.endpoint = args.endpoint;

    if (!args.lighthouse) {
      // Add lighthouses as private DNS resolvers for pod's containers
      // TODO fix public DNS (deploy dnsmasq?)
      // TODO add service DNS, once we have services
      for (const lh of args.endpoint.network.lighthouses) {
        args.pod.addDnsResolver(lh.overlayIp);
      }
    }

    // Generate Nebula configuration and upload it to host
    const config = new oci.LocalFile(
      `${name}-nebula-config`,
      {
        pod: args.pod,
        source: composeConfig(this.endpoint, args.lighthouse ?? false).apply(
          (cfg) => new pulumi.asset.StringAsset(JSON.stringify(cfg)),
        ),
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
        name: 'nebula', // TODO what about multiple networks for one pod?
        ports: [
          [this.endpoint.underlayPort, this.endpoint.underlayPort, 'udp'],
        ],
        mounts: [[config, '/config/config.yml']], // It is actually JSON, but this is the expected path
        linuxCapabilities: ['NET_ADMIN'],
        linuxDevices: ['/dev/net/tun'],
        disablePodDns: true, // Lighthouse DNS is for user applications, not Nebula itself
        dnsSearchDomain: this.endpoint.network.underlayDnsSearchDomain,
        // TODO test that this actually works with bridge network
      },
      {
        parent: this,
      },
    );
  }
}
