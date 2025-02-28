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
    respond: boolean;
  };
  tun: {
    disabled: boolean;
    dev: string;
  };
  firewall: {
    outbound: NebulaFirewallRule[];
    inbound: NebulaFirewallRule[];
  };
  logging: {
    level: string;
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
  config: {
    isLighthouse: boolean;
    underlayPort: pulumi.Input<number>;
  },
): pulumi.Output<NebulaConfig> {
  return pulumi.output({
    pki: {
      ca: endpoint.network.currentCa.certificate,
      cert: endpoint.certificate,
      key: endpoint.privateKey,
    },
    // Underlay addresses of lighthouses, unless this is the lighthouse
    static_host_map: config.isLighthouse
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
      am_lighthouse: config.isLighthouse,
      hosts: config.isLighthouse
        ? []
        : endpoint.network.lighthouses.map((lh) => lh.overlayIp),
      // If this is lighthouse, serve DNS - but only over the overlay network!
      serve_dns: config.isLighthouse,
      dns: config.isLighthouse
        ? { host: endpoint.overlayIp, port: 53 }
        : undefined,
    },
    // Listen to underlay network
    listen: {
      host: '::', // All interfaces, both IPv4 and IPv6
      port: config.underlayPort,
    },
    // Enable basic NAT traversal just in case endpoint needs it, very little harm in that
    punchy: {
      punch: true,
      respond: true,
    },
    tun: {
      disabled: false, // Even lighthouses need this for DNS
      dev: pulumi
        .all([endpoint.network.networkId, endpoint.hostname])
        .apply(
          ([networkId, hostname]) =>
            `nb${networkId.replace('-', '').substring(0, 5)}${hostname.replace('-', '').substring(0, 8)}`,
        ),
    },
    firewall: {
      outbound: endpoint.firewall.outbound.map((rule) =>
        convertFirewallRule(endpoint, rule),
      ),
      inbound: endpoint.firewall.inbound.map((rule) =>
        convertFirewallRule(endpoint, rule),
      ),
    },
    logging: {
      level: 'debug',
    },
  });
}

function convertFirewallRule(
  endpoint: Endpoint,
  rule: FirewallRule,
): pulumi.Output<NebulaFirewallRule> {
  return pulumi.output({
    port: rule.port,
    proto: rule.proto ?? 'any',
    // Add DNS domain to hostnames in firewall for consistency with rest of Flock config
    host:
      'host' in rule
        ? rule.host == 'any'
          ? 'any'
          : pulumi.interpolate`${rule.host}.${endpoint.network.dnsDomain}`
        : undefined,
    groups: 'groups' in rule ? rule.groups : undefined,
  });
}
