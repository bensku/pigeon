import * as pulumi from '@pulumi/pulumi';
import * as host from '../host';
import * as ipam from '../ipam';
import * as oci from '../oci';
import { certManagerCmd } from './cert-manager';
import { PodAttachment } from './container';
import { Endpoint, EndpointArgs } from './endpoint';
import { Enrollment } from './host';

export interface NetworkArgs {
  /**
   * Current epoch of the network. This should be periodically increased by 1
   * to create and deploy new CAs to endpoints without downtime.
   */
  epoch: number;

  /**
   * IP range of this network in CIDR notation. Nebula supports IPv4 only for now :(
   *
   * @example 10.1.2.0/24
   */
  ipRange: string;

  lighthouses: host.Host[];
  ipamHost?: ipam.IpamHost;

  domain?: string;

  /**
   * Port range that hosts use for sending encrypted Nebula traffic.
   */
  underlayPortRange?: [number, number];

  /**
   * Underlay DNS search domain. This may be necessary if the lighthouses are
   * discovered using private DNS. Do not use unless you're seeing DNS errors
   * on Nebula containers.
   */
  underlayDnsSearchDomain?: string;
}

interface Lighthouse {
  underlayAddress: pulumi.Output<string>;
  overlayIp: pulumi.Output<string>;
}

export class Network extends pulumi.ComponentResource {
  #name: string;
  readonly domain: string;
  readonly underlayPortRange: [number, number];
  readonly ipam: ipam.Network;
  readonly lighthouses: Lighthouse[];
  readonly underlayDnsSearchDomain?: string;

  #epochs: [CaCertificate, CaCertificate];

  #enrolledHosts: Map<host.Host, Enrollment> = new Map();

  constructor(
    name: string,
    args: NetworkArgs,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super('pigeon:flock:Network', name, args, opts);
    this.#name = name;
    this.domain = args.domain ?? 'pigeon.internal';
    this.underlayPortRange = args.underlayPortRange ?? [30000, 31000];
    this.underlayDnsSearchDomain = args.underlayDnsSearchDomain;
    this.#enrolledHosts = new Map();

    // Initialize IPAM for this network
    const ipamHost =
      args.ipamHost ??
      new ipam.IpamHost(
        `${name}-ipam-host`,
        { host: args.lighthouses[0] },
        { parent: this },
      );
    this.ipam = new ipam.Network(
      `${name}-ipam`,
      { ipamHost, cidr: args.ipRange },
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
    this.lighthouses = args.lighthouses.map((target, i) => {
      const pod = new oci.Pod(`${name}-lh-pod-${i}`, {
        host: target,
        name: 'flock-lighthouse',
      });
      const endpoint = new Endpoint(`${name}-lh-${i}`, {
        network: this,
        hostname: `h1${i}.lighthouses`,
        groups: ['lighthouses'],
        // TODO support custom port ranges for lighthouses
        host: this.enrollHost(target),
        // Lighthouses should not send or receive any normal traffic
        firewall: {
          // Lighthouses also serve as private DNS resolvers
          inbound: [{ host: 'any', port: 53 }],
          outbound: [],
        },
      });
      endpoint.attachTo(pod, true);
      // TODO what if the host we're using for SSH is not public? add another host option?
      const underlayIp = pulumi
        .output(target.connection)
        .apply((conn) => conn.host);
      return {
        underlayAddress: pulumi.interpolate`${underlayIp}:${endpoint.underlayPort}`,
        overlayIp: endpoint.overlayIp,
      };
    });
  }

  get currentCa() {
    return this.#epochs[1];
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

  /**
   * Enrolls a host to this network. It is safe to call this multiple times
   * for the same host.
   * @param host Host.
   * @returns Enrollment information.
   */
  enrollHost(host: host.Host): Enrollment {
    if (this.#enrolledHosts.has(host)) {
      return this.#enrolledHosts.get(host)!;
    }
    const enrollment = new Enrollment(
      `${this.#name}-host-${host.name}`,
      {
        host: host,
        network: this,
        portRange: this.underlayPortRange,
      },
      { parent: this },
    );
    this.#enrolledHosts.set(host, enrollment);
    return enrollment;
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
      host: this.enrollHost(pod.host),
      network: this,
    });
    return new PodAttachment(`${this.#name}-attach-${pod.name}`, {
      pod,
      endpoint,
    });
  }
}

export interface CaCertificate {
  privateKey: pulumi.Output<string>;
  certificate: pulumi.Output<string>;
}
