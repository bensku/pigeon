import * as pulumi from '@pulumi/pulumi';
import * as random from '@pulumi/random';
import stringify from 'json-stable-stringify';
import * as host from './host';
import * as etcd from './etcd';
import * as flock from './flock';
import * as oci from './oci';

interface ClusterArgs {
  /**
   * Hosts where to run PostgreSQL nodes. Patroni will elect one of them as
   * primary, while the rest will be read-only replicas. If a primary ever
   * becomes unreachable, a new one will be elected.
   *
   * At least 2 hosts are needed for high availability. Adding more than that
   * makes the system more resilient, but is not required.
   */
  hosts: host.Host[];

  network: flock.Network;

  /**
   * Etcd cluster for Patroni's leader elections. Multiple Patroni clusters
   * can share the same etcd cluster.
   */
  etcd: etcd.Cluster;

  clientGroups: string[];
}

export class Cluster extends pulumi.ComponentResource {
  readonly clusterName: pulumi.Output<string>;

  constructor(
    name: string,
    args: ClusterArgs,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super('pigeon:patroni:Cluster', name, args, opts);
    const randomId = new random.RandomUuid(`${name}-id`, {}, { parent: this });
    this.clusterName = pulumi.interpolate`${name}-${randomId.result}`;

    // Generate Postgres passwords needed by Patroni
    const passwords = {
      superuser: new random.RandomPassword(
        `${name}-superuser-passwd`,
        {
          length: 32,
        },
        { parent: this },
      ).result,
      replication: new random.RandomPassword(
        `${name}-replication-passwd`,
        {
          length: 32,
        },
        { parent: this },
      ).result,
      rewind: new random.RandomPassword(
        `${name}-rewind-passwd`,
        {
          length: 32,
        },
        { parent: this },
      ).result,
    };

    const dnsSuffix = pulumi.interpolate`${this.clusterName}.${args.network.dnsDomain}`;
    const firewall: flock.FirewallPolicy = {
      inbound: [
        {
          groups: ['postgres'],
          port: 5432,
        },
        {
          groups: ['postgres'],
          port: 8008,
        },
        ...args.clientGroups.map((group) => ({
          groups: [group],
          port: 5432,
        })),
      ],
      outbound: [
        {
          groups: ['etcd'],
          port: 2379,
        },
        // We already restrict inbound traffic within group, no need to restrict outbound
        {
          groups: ['postgres'],
          port: 'any',
        },
      ],
    };

    for (const host of args.hosts) {
      const podNet: flock.PodConfig = {
        hostname: pulumi.interpolate`${host.name}.${this.clusterName}`,
        groups: ['postgres'],
        firewall,
      };

      const pod = new oci.Pod(`${name}-${host.name}-pod`, {
        host,
        name: pulumi.interpolate`${this.clusterName}-patroni`,
        networks: [
          {
            network: args.network,
            config: podNet,
          },
        ],
      });

      const data = new oci.Volume(`${name}-${host.name}-data`, {
        pod,
        name: 'data',
      });

      const config = this.#patroniConfig(host, args.etcd, dnsSuffix, passwords);
      const configFile = new oci.LocalFile(`${name}-${host.name}-config`, {
        pod,
        source: config.apply((cfg) => stringify(cfg)!),
      });

      new oci.Container(`${name}-${host.name}-container`, {
        pod,
        name: 'patroni',
        image: 'ghcr.io/bensku/pigeon/patroni', // TODO do not hardcode
        mounts: [
          [data, '/data'],
          [configFile, '/etc/patroni.yml'],
        ],
      });
    }
  }

  #patroniConfig(
    host: host.Host,
    etcd: etcd.Cluster,
    dnsSuffix: pulumi.Input<string>,
    passwords: {
      superuser: pulumi.Input<string>;
      replication: pulumi.Input<string>;
      rewind: pulumi.Input<string>;
    },
  ): pulumi.Output<PatroniConfig> {
    const nodeDomain = pulumi.interpolate`${host.name}.${dnsSuffix}`;
    return pulumi.output({
      namespace: '/pigeon-managed/patroni/',
      scope: this.clusterName,
      name: pulumi.interpolate`${this.clusterName}-${host.name}`,
      restapi: {
        listen: '0.0.0.0:8008',
        connect_address: pulumi.interpolate`${nodeDomain}:8008`,
      },
      etcd3: {
        hosts: etcd.etcdEndpoints,
      },
      bootstrap: {
        dcs: {
          postgresql: {
            use_pg_rewind: true,
            pg_hba: [
              'host replication replicator 0.0.0.0/0 md5',
              'host all all 0.0.0.0/0 md5',
            ],
          },
        },
        initdb: [{ encoding: 'utf-8' }, 'data-checksums'],
      },
      postgresql: {
        listen: '0.0.0.0:5432',
        connect_address: pulumi.interpolate`${nodeDomain}:5432`,
        data_dir: '/data/postgres',
        pgpass: '/data/pgpass0',
        authentication: {
          superuser: {
            username: 'postgres',
            password: passwords.superuser,
          },
          replication: {
            username: 'replicator',
            password: passwords.replication,
          },
          rewind: {
            username: 'rewind_user',
            password: passwords.rewind,
          },
        },
        callbacks: {}, // TODO service DNS
      },
      tags: {},
    });
  }
}

interface PatroniConfig {
  namespace: string;

  /**
   * Cluster name.
   */
  scope: string;

  /**
   * Name of this node.
   */
  name: string;

  restapi: {
    listen: string;
    connect_address: string;
  };

  etcd3: {
    hosts: string[];
  };

  bootstrap: {
    dcs: {
      postgresql: {
        use_pg_rewind: boolean;
        pg_hba: string[];
      };
    };

    initdb: unknown[];
  };

  postgresql: {
    listen: string;
    connect_address: string;

    data_dir: string;

    pgpass: string;
    authentication: {
      superuser: {
        username: string;
        password: string;
      };
      replication: {
        username: string;
        password: string;
      };
      rewind: {
        username: string;
        password: string;
      };
    };

    callbacks: Partial<{
      on_reload: string;
      on_restart: string;
      on_role_change: string;
      on_start: string;
      on_stop: string;
    }>;
  };

  tags: Partial<{
    clonefrom: boolean;
    noloadbalance: boolean;
    replicatefrom: boolean;
    nosync: boolean;
    nofailover: boolean;
    failover_priority: number;
    nostream: boolean;
  }>;
}
