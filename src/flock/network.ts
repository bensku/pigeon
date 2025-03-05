import * as pulumi from '@pulumi/pulumi';
import * as random from '@pulumi/random';
import * as host from '../host';
import * as ipam from '../ipam';
import * as oci from '../oci';
import { certManagerCmd } from './cert-manager';
import { PodAttachment } from './container';
import { Endpoint, EndpointArgs } from './endpoint';

export interface NetworkArgs {
  /**
   * Current epoch of the network. This can be increased to rotate
   * certificates within the network.
   */
  epoch: number;

  /**
   * IP range of this network in CIDR notation. Nebula supports IPv4 only for now :(
   *
   * @example 10.1.2.0/24
   */
  ipRange: string;

  /**
   * Lighthouses, i.e. hosts that provide discovery and DNS services for this
   * network. The first lighthouse will also serve as IPAM data storage by default.
   */
  lighthouses: { host: host.Host; underlayPort: number }[];

  /**
   * Custom IPAM host. Default is to create a new one on the first lighthouse.
   */
  ipamHost?: ipam.IpamHost;

  /**
   * DNS domain to use for this network. Defaults to `pigeon.internal`.
   * Endpoints in network will receive names such as `test-pod.pigeon.internal`.
   */
  domain?: string;
}

export type PodConfig = Omit<Omit<EndpointArgs, 'network'>, 'host'>;

interface Lighthouse {
  underlayAddress: pulumi.Output<string>;
  overlayIp: pulumi.Output<string>;
}

/**
 * Flock is an overlay networking tool based on [Nebula](https://github.com/slackhq/nebula).
 * It provides encrypted communications and private DNS for OCI pods or their host machines.
 */
export class Network
  extends pulumi.ComponentResource
  implements oci.PodNetworkProvider<PodConfig>
{
  #name: string;
  readonly networkId: pulumi.Output<string>;
  readonly dnsDomain: pulumi.Output<string>;

  readonly ipam: ipam.Network;
  readonly lighthouses: Lighthouse[];
  readonly #dnsServers: pulumi.Output<string>[];

  #epochs: [CaCertificate, CaCertificate];

  constructor(
    name: string,
    args: NetworkArgs,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super('pigeon:flock:Network', name, args, opts);
    this.#name = name;
    const randomId = new random.RandomUuid(`${name}-id`, {}, { parent: this });
    this.networkId = pulumi.interpolate`${name}-${randomId.result}`;
    this.dnsDomain = pulumi.output(args.domain ?? 'pigeon.internal');

    // Initialize IPAM for this network
    const ipamHost =
      args.ipamHost ??
      args.lighthouses[0].host.addSetupTask(
        'ipam-host',
        (host, name) => new ipam.IpamHost(name, { host }, { parent: this }),
      );
    this.ipam = new ipam.Network(
      `${name}-ipam`,
      { ipamHost, cidr: args.ipRange, networkId: this.networkId },
      { parent: this },
    );

    // Create CAs for current and previous epoch
    // These get installed to endpoints as trusted CAs
    // The idea is that you can rotate certs by increasing epoch by one and deploying;
    // Pulumi will automatically update endpoints and destroy older CA resources
    // ... without network downtime, of course!
    this.#epochs = [
      this.#createCaForEpoch(
        `${name} CA epoch ${args.epoch - 1}`,
        args.epoch - 1,
      ),
      this.#createCaForEpoch(`${name} CA epoch ${args.epoch}`, args.epoch),
    ];

    // Create lighthouses
    this.lighthouses = args.lighthouses.map(({ host, underlayPort }, i) => {
      const pod = new oci.Pod(`${name}-lh-pod-${i}`, {
        host,
        name: 'flock-lighthouse',
        networks: [],
      });
      const endpoint = new Endpoint(`${name}-lh-${i}`, {
        network: this,
        hostname: `lh${i}.lighthouses`,
        groups: ['lighthouses'],
        firewall: {
          // Lighthouses also serve as private DNS resolvers
          inbound: [{ host: 'any', port: 53 }],
          outbound: [],
        },
      });
      endpoint.attachTo(pod, true, underlayPort);
      // TODO what if the host we're using for SSH is not public? add another host option?
      const underlayIp = pulumi
        .output(host.connection)
        .apply((conn) => conn.host);
      return {
        underlayAddress: pulumi.interpolate`${underlayIp}:${underlayPort}`,
        overlayIp: endpoint.overlayIp,
      };
    });
    this.#dnsServers = this.lighthouses.map((lh) => lh.overlayIp);
  }

  #createCaForEpoch(name: string, epoch: number): CaCertificate {
    const privateKey = certManagerCmd(this, `${name}-epoch-${epoch}-ca-key`, {
      mode: 'ca',
      target: 'key',
    });
    const certificate = certManagerCmd(this, `${name}-epoch-${epoch}-ca-cert`, {
      mode: 'ca',
      target: 'cert',
      caKey: privateKey,
      caConfig: {
        name: name,
        validNotBefore: new Date(0).toISOString(),
        validNotAfter: '2500-01-01T00:00:00.000Z',
      },
    });
    return { privateKey, certificate };
  }

  get currentCa() {
    return this.#epochs[1];
  }

  /**
   * Creates an endpoint to this network and attaches it to given pod.
   * @param pod The pod to attach.
   * @param args Endpoint configuration, e.g. hostname, groups, firewall rules etc.
   * @returns The pod attachment. Endpoint is available as field in it.
   */
  attachPod(
    pod: oci.Pod,
    args: Omit<Omit<EndpointArgs, 'network'>, 'host'>,
  ): PodAttachment {
    const endpoint = new Endpoint(`${this.#name}-endpoint-${pod.name}`, {
      ...args,
      network: this,
    });
    return new PodAttachment(`${this.#name}-attach-${pod.name}`, {
      pod,
      endpoint,
    });
  }

  dnsServers(pod: oci.Pod): pulumi.Output<string>[] {
    return this.#dnsServers; // Same for all, for now
  }
}

export interface CaCertificate {
  privateKey: pulumi.Output<string>;
  certificate: pulumi.Output<string>;
}
