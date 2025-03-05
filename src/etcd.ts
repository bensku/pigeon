import * as pulumi from '@pulumi/pulumi';
import * as random from '@pulumi/random';
import * as host from './host';
import * as oci from './oci';
import * as flock from './flock';

interface EtcdClusterArgs {
  /**
   * Hosts that should be part of this etcd cluster.
   * 3 or 5 nodes is a good choice. See
   * [etcd FAQ](https://etcd.io/docs/v3.5/faq/) for more information.
   */
  hosts: host.Host[];

  /**
   * Network for connecting to cluster and its internal communications.
   */
  network: flock.Network;

  /**
   * Groups that allow network endpoints to connect to this cluster.
   * This only applies to etcd's public API.
   */
  clientGroups: string[];
}

/**
 * A highly available [etcd](https://etcd.io/) cluster.
 */
export class EtcdCluster extends pulumi.ComponentResource {
  /**
   * Etcd endpoints of this cluster. For high availability, configure your
   * application to use ALL of these endpoints.
   */
  readonly etcdEndpoints: pulumi.Output<string>[];

  constructor(
    name: string,
    args: EtcdClusterArgs,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super('pigeon:apps:EtcdCluster', name, args, opts);

    const clusterId = new random.RandomUuid(`${name}-id`, {}, { parent: this });

    // Permit etcd traffic in and out
    const clusterRules: flock.FirewallRule[] = [
      {
        groups: ['etcd'],
        port: 2380,
      },
    ];

    // Pre-create etcd endpoint FQDNs, since every endpoint needs them all
    const endpointNames = args.hosts.map(
      (h) => pulumi.interpolate`${h.name}.etcd-${clusterId.id}`,
    );
    const fqdns = endpointNames.map(
      (name) => pulumi.interpolate`${name}.${args.network.dnsDomain}`,
    );
    this.etcdEndpoints = fqdns.map(
      (name) => pulumi.interpolate`http://${name}:2379`,
    );

    // Create initial cluster configuration for etcd bootstrapping
    const nodeNames = args.hosts.map((h) => pulumi.interpolate`node-${h.name}`);
    const initialCluster = pulumi.concat(
      ...fqdns.map((fqdn, i, arr) =>
        i < arr.length - 1
          ? pulumi.interpolate`${nodeNames[i]}=http://${fqdn}:2380,`
          : pulumi.interpolate`${nodeNames[i]}=http://${fqdn}:2380`,
      ),
    );

    for (const [i, host] of args.hosts.entries()) {
      // Configure Flock network endpoint
      const netConfig: flock.PodConfig = {
        hostname: endpointNames[i],
        groups: ['etcd'],
        firewall: {
          inbound: [
            ...clusterRules,
            // Permit client traffic to this cluster
            {
              groups: args.clientGroups,
              port: 2379,
            },
          ],
          outbound: clusterRules,
        },
      };

      // Create pod and etcd storage volume
      const pod = new oci.Pod(`${name}-pod-${host.name}`, {
        host: host,
        name: pulumi.interpolate`etcd-${clusterId.id}`,
        networks: [
          {
            network: args.network,
            config: netConfig,
          },
        ],
      });
      const data = new oci.Volume(`${name}-data-${host.name}`, {
        pod,
        name: 'data',
      });

      // Create the actual container
      new oci.Container(`${name}-container-${host.name}`, {
        pod,
        name: 'etcd',
        image: 'gcr.io/etcd-development/etcd:v3.5.19', // TODO do not hardcode
        mounts: [[data, '/etcd-data']],
        command: pulumi.interpolate`/usr/local/bin/etcd --data-dir /etcd-data --name ${nodeNames[i]} \
--initial-advertise-peer-urls http://${fqdns[i]}:2380 --listen-peer-urls http://0.0.0.0:2380 \
--advertise-client-urls ${this.etcdEndpoints[i]} --listen-client-urls http://0.0.0.0:2379 \
--initial-cluster ${initialCluster} \
--initial-cluster-state new --initial-cluster-token ${clusterId.id}`,
      });
    }
  }
}
