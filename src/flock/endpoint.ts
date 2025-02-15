import * as pulumi from '@pulumi/pulumi';
import * as ipam from '../ipam';
import * as oci from '../oci';
import { Enrollment } from './host';
import { Network } from './network';
import { certManagerCmd } from './cert-manager';
import { PodAttachment } from './container';

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

export class Endpoint extends pulumi.ComponentResource {
  #name: string;

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
  readonly overlayIp: pulumi.Output<string>;

  /**
   * Nebula private key for this endpoint.
   */
  readonly privateKey: pulumi.Output<string>;

  /**
   * Certificate of this endpoint.
   */
  readonly certificate: pulumi.Output<string>;

  /**
   * Port this endpoint uses to communicate over real (underlay) network.
   */
  readonly underlayPort: pulumi.Output<number>;

  /**
   * The firewall policy of this endpoint.
   */
  readonly firewall: FirewallPolicy;

  constructor(
    name: string,
    args: EndpointArgs,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super('pigeon:flock:Endpoint', name, args, opts);
    this.#name = name;
    this.network = args.network;
    this.firewall = args.firewall;
    const ca = args.network.currentCa;
    this.hostname = pulumi.interpolate`${args.hostname}.${args.network.domain}`;

    const addr = new ipam.IpAddress(`${name}-ip`, {
      network: args.network.ipam,
    });
    this.overlayIp = addr.address;

    this.privateKey = certManagerCmd(this, `${name}-endpoint-key`, {
      mode: 'host',
      target: 'key',
      caKey: ca.privateKey,
    });
    this.certificate = certManagerCmd(this, `${name}-endpoint-cert`, {
      mode: 'host',
      target: 'cert',
      caKey: ca.privateKey,
      caCert: ca.certificate,
      hostKey: this.privateKey,
      certConfig: {
        name: this.hostname,
        network: pulumi.interpolate`${addr.address}/${args.network.ipam.prefixLength}`,
        groups: args.groups,
        validNotBefore: new Date(0).toISOString(),
        validNotAfter: '2500-01-01T00:00:00.000Z',
      },
    });
    this.underlayPort = new ipam.PortAllocation(`${name}-underlay-port`, {
      host: args.host.portHost,
    }).port;
  }

  attachTo(pod: oci.Pod, lighthouse?: boolean): PodAttachment {
    return new PodAttachment(`${this.#name}-attach-${pod.name}`, {
      pod,
      endpoint: this,
      lighthouse,
    });
  }
}
