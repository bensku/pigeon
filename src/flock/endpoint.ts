import * as pulumi from '@pulumi/pulumi';
import * as ipam from '../ipam';
import * as oci from '../oci';
import { Enrollment } from './host';
import { Network } from './network';
import { certManagerCmd } from './cert-manager';
import { PodAttachment } from './container';
import { EndpointProvider } from './endpoint-provider';

export interface EndpointArgs {
  /**
   * Network this endpoint belongs to.
   */
  network: Network;

  /**
   * Host that the endpoint will work on. This is needed for setting up
   * underlay communications.
   */
  host: Enrollment;

  /**
   * Hostname for this particular endpoint. This is in no way related to the
   * actual host it is running on.
   */
  hostname: pulumi.Input<string>;

  /**
   * Groups for the endpoint. Other endpoints may specify groups in their
   * firewall rules.
   */
  groups: pulumi.Input<string[]>;

  /**
   * Firewall rules for this endpoint. An empty policy denies all traffic
   * in and out; rules can selectively allow it. The firewall is stateful.
   */
  firewall: FirewallPolicy;
}

export interface FirewallPolicy {
  /**
   * Rules for allowing inbound firewall traffic. The firewall is stateful, so
   * it is not necessary to allow outbound response traffic.
   */
  inbound: FirewallRule[];

  /**
   * Rules for allowing outbound traffic. Do NOT include rules for response
   * traffic; they are unnecessary since this firewall is stateful.
   */
  outbound: FirewallRule[];
}

interface BaseFirewallRule {
  /**
   * TCP/UDP port that is allowed, or 'any' to allow all ports.
   */
  port: number | 'any';

  /**
   * Protocol to allow. Defaults to 'any'.
   */
  proto?: 'any' | 'tcp' | 'udp' | 'icmp';
}

interface HostFirewallRule extends BaseFirewallRule {
  /**
   * Hostname of allowed host, or 'any' to allow EVERYONE in the same network.
   */
  host: string;
}

interface GroupFirewallRule extends BaseFirewallRule {
  /**
   * List of groups whose endpoints should be allowed.
   */
  groups: string[];
}

export type FirewallRule = HostFirewallRule | GroupFirewallRule;

export class Endpoint extends pulumi.dynamic.Resource {
  #name: string;

  /**
   * Generated unique endpoint id.
   */
  declare readonly endpointId: pulumi.Output<string>;

  /**
   * Network this endpoint belongs to.
   */
  readonly network: Network;

  /**
   * Fully qualified host name for endpoint.
   */
  readonly hostname: pulumi.Output<string>;

  /**
   * IP address of the endpoint within the overlay network.
   */
  declare readonly overlayIp: pulumi.Output<string>;

  /**
   * Nebula private key for this endpoint.
   */
  declare readonly privateKey: pulumi.Output<string>;

  /**
   * Certificate of this endpoint.
   */
  declare readonly certificate: pulumi.Output<string>;

  /**
   * The firewall policy of this endpoint.
   */
  readonly firewall: FirewallPolicy;

  constructor(
    name: string,
    args: EndpointArgs,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super(
      new EndpointProvider(),
      name,
      {
        ipamConnection: args.network.ipam.ipamHost.connection,
        networkId: args.network.networkId,
        networkPrefixLen: args.network.ipam.prefixLength,

        caKey: args.network.currentCa.privateKey,
        caCert: args.network.currentCa.certificate,
        hostname: pulumi.interpolate`${args.hostname}.${args.network.dnsDomain}`,
        groups: args.groups,

        // Outputs
        endpointId: undefined,
        overlayIp: undefined,
        privateKey: undefined,
        certificate: undefined,
      },
      {
        ...opts,
        // TODO do not break custom dependsOn
        dependsOn: [args.network],
      },
    );
    this.#name = name;
    this.network = args.network;
    this.firewall = structuredClone(args.firewall);
    this.#patchFirewallPolicy();
    this.hostname = pulumi.interpolate`${args.hostname}.${args.network.dnsDomain}`;
  }

  #patchFirewallPolicy() {
    // Allow lighthouse DNS
    this.firewall.outbound.push({
      groups: ['lighthouses'],
      port: 53,
    });
  }

  attachTo(
    pod: oci.Pod,
    lighthouse?: boolean,
    underlayPort?: pulumi.Input<number>,
  ): PodAttachment {
    return new PodAttachment(`${this.#name}-attach-${pod.name}`, {
      pod,
      endpoint: this,
      lighthouse,
      underlayPort: pulumi.output(underlayPort ?? 0),
    });
  }
}
