import * as pulumi from '@pulumi/pulumi';
import { Endpoint, FirewallRule } from './endpoint';

interface NebulaConfig {
  pki: {
    ca: string;
    cert: string;
    key: string;
  };
  static_host_map: {
    [key: string]: string[];
  };
  lighthouse: {
    am_lighthouse: boolean;
    hosts: string[];

    serve_dns: boolean;
    dns?: {
      host: string;
      port: number;
    };
  };
  listen: {
    host: string;
    port: number;
  };
  punchy: {
    punch: boolean;
    response: boolean;
  };
  tun: {
    disabled: boolean;
  };
  firewall: {
    outbound: NebulaFirewallRule[];
    inbound: NebulaFirewallRule[];
  };
}

interface NebulaFirewallRule {
  port: number | 'any';
  proto: 'any' | 'tcp' | 'udp' | 'icmp';
  host?: string;
  groups?: string[];
  cidr?: string;
}

export function composeConfig(
  endpoint: Endpoint,
  isLighthouse: boolean,
): pulumi.Output<NebulaConfig> {
  return pulumi.output({
    pki: {
      ca: endpoint.network.currentCa.certificate,
      cert: endpoint.certificate,
      key: endpoint.privateKey,
    },
    // Underlay addresses of lighthouses, unless this is the lighthouse
    static_host_map: isLighthouse
      ? ({} as NebulaConfig['static_host_map'])
      : pulumi
          .all(endpoint.network.lighthouses)
          .apply((lighthouses) =>
            Object.fromEntries(
              lighthouses.map((lh) => [lh.overlayIp, [lh.underlayAddress]]),
            ),
          ),
    // Lighthouse configuration (note the overlay, not underlay addresses!)
    lighthouse: {
      am_lighthouse: isLighthouse,
      hosts: isLighthouse
        ? []
        : endpoint.network.lighthouses.map((lh) => lh.overlayIp),
      // If this is lighthouse, serve DNS - but only over the overlay network!
      serve_dns: isLighthouse,
      dns: isLighthouse ? { host: endpoint.overlayIp, port: 53 } : undefined,
    },
    // Listen to underlay network
    listen: {
      host: '::', // All interfaces, both IPv4 and IPv6
      port: endpoint.underlayPort,
    },
    // Enable basic NAT traversal just in case endpoint needs it, very little harm in that
    punchy: {
      punch: true,
      response: false,
    },
    tun: {
      disabled: false, // Even lighthouses need this for DNS
    },
    firewall: {
      outbound: endpoint.firewall.outbound.map(convertFirewallRule),
      inbound: endpoint.firewall.inbound.map(convertFirewallRule),
    },
  });
}

function convertFirewallRule(rule: FirewallRule): NebulaFirewallRule {
  return {
    port: rule.port,
    proto: rule.proto ?? 'any',
    host: 'host' in rule ? rule.host : undefined,
    groups: 'groups' in rule ? rule.groups : undefined,
  };
}
