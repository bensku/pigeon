import * as pulumi from '@pulumi/pulumi';
import * as systemd from '../systemd';
import * as ssh from '../ssh';
import { Pod } from './pod';
import { LocalFile, Volume } from './volume';

export interface ContainerArgs {
  /**
   * Pod this container is part of.
   */
  pod: Pod;

  /**
   * Name of the container. This MUST be unique within pod.
   */
  name: pulumi.Input<string>;

  /**
   * Identifier of container image to use. This must be fully qualified,
   * no special treatment is given to Docker Hub.
   *
   * @example docker.io/nginx:latest
   */
  image: pulumi.Input<string>;

  /**
   * List of volume mounts for this container. Host path -> container path:
   *
   * Supported types of host paths are:
   * * string: Host directory or file
   * * Volume: Managed oci.Volume
   * * LocalFile: oci.LocalFile (or directory) that is part of this container's pod
   */
  mounts?: [pulumi.Input<string> | Volume | LocalFile, string][];

  /**
   * Environment variables, name -> value.
   */
  // TODO actually test Podman secrets!
  environment?: [pulumi.Input<string>, pulumi.Input<string | SecretRef>][];

  /**
   * Container entrypoint. If set, this replaces the image's default entrypoint.
   */
  entrypoint?: pulumi.Input<string>;

  /**
   * Container command, i.e. the value that is passed to its entrypoint.
   * If set, this replaces the image's default command.
   */
  command?: pulumi.Input<string>;

  /**
   * Additional Linux capabilities to grant to the container.
   *
   * @example CAP_NET_ADMIN
   */
  linuxCapabilities?: string[];

  /**
   * Additional Linux devices this container should get access to.
   */
  linuxDevices?: string[];

  /**
   * Network mode for this container.
   *
   * Supported network modes are:
   * * `pod`: Uses pod network, i.e. every container in pod is `localhost`
   *   to each other. Recommended for normal usage.
   * * `bridge`: Creates a separate bridge network for this container and
   *   grants it outgoing access through Podman NAT.
   * * `private`: Same as `bridge`, but without any outgoing access by default.
   * * `host`: Uses host networking.
   *
   * The default, `pod` network, is usually what you want. `host` network may be
   * useful for performance-critical containers or custom OCI network systems,
   * but is also a potential security risk. `bridge` and `private` networks
   * should rarely be used outside of Pigeon's networking system.
   *
   * @default 'pod'
   */
  networkMode?: 'pod' | 'bridge' | 'private' | 'host';
  bridgePorts?: [
    pulumi.Input<number>,
    pulumi.Input<number>,
    ('tcp' | 'udp')?,
  ][];
  podDns?: string;
  dnsSearchDomain?: pulumi.Input<string>;
}

interface SecretRef {
  secretName: string;
}

/**
 * OCI container, deployed using Podman.
 */
export class Container extends pulumi.ComponentResource {
  readonly containerName: pulumi.Output<string>;
  readonly serviceName: pulumi.Output<string>;

  constructor(
    name: string,
    args: ContainerArgs,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super('pigeon:oci:Container', name, args, opts);
    this.containerName = pulumi.interpolate`${args.pod.podName}-${args.name}`;

    // Make sure pod and volumes exist before we bring up the container
    // Also, if we're uploading a local file, make service dependent on it
    const dependsOn: pulumi.Resource[] = [args.pod];
    const triggers: pulumi.Input<pulumi.asset.Asset>[] = [];
    for (const [volume] of args.mounts ?? []) {
      if (volume instanceof Volume || volume instanceof LocalFile) {
        dependsOn.push(volume);
      }
      if (volume instanceof LocalFile) {
        triggers.push(volume.source);
      }
    }

    // Use SSH directly to reduce resource bloat
    new ssh.RunActions(
      `${name}-service`,
      {
        connection: args.pod.host.connection,
        actions: containerSshActions(args),
        triggers,
      },
      {
        parent: this,
        dependsOn,
        deleteBeforeReplace: true,
      },
    );
    this.serviceName = pulumi.interpolate`${args.pod.podName}-${args.name}`;
    args.pod.containers.push(this);
  }
}

export function containerSshActions(args: ContainerArgs): ssh.Action[] {
  const containerName = pulumi.interpolate`${args.pod.podName}-${args.name}`;
  const networkMode = args.networkMode ?? 'pod';
  if (args.bridgePorts && networkMode != 'bridge') {
    throw new Error(
      'containers that use pod networking cannot use direct ports',
    );
  }

  const mounts = pulumi.concat(
    ...(args.mounts ?? []).map(([volume, target]) => {
      let volumeName: pulumi.Input<string>;
      if (volume instanceof Volume) {
        volumeName = volume.volumeName;
      } else if (volume instanceof LocalFile) {
        volumeName = volume.filePath;
      } else {
        volumeName = volume;
      }
      return pulumi.interpolate`Volume=${volumeName}:${target}\n`;
    }),
  );

  // TODO consider escaping environment variables...
  const env = pulumi.concat(
    ...(args.environment ?? []).map(([key, value]) =>
      pulumi.output(value).apply((value) => {
        if (typeof value === 'object' && 'secretName' in value) {
          // Podman secret to reference
          return pulumi.interpolate`Secret=${value.secretName},type=env,target=${key}\n`;
        }
        // Normal environment variable
        return pulumi.interpolate`Environment=${key}=${value}\n`;
      }),
    ),
  );

  const ports = pulumi.concat(
    ...(args.bridgePorts ?? []).map(
      ([hostPort, containerPort, proto]) =>
        pulumi.interpolate`PublishPort=${hostPort}:${containerPort}/${proto ?? 'tcp'}\n`,
    ),
  );

  const capabilities = args.linuxCapabilities
    ? args.linuxCapabilities.map((cap) => `AddCapability=${cap}`).join('\n')
    : '';

  const devices = args.linuxDevices
    ? args.linuxDevices.map((dev) => `AddDevice=${dev}`).join('\n')
    : '';

  const unit = pulumi.interpolate`[Unit]
Description=Container ${args.name} in pod ${args.pod.podName}
${
  networkMode == 'pod'
    ? pulumi.interpolate`Requires=${args.pod.podNetService}.service
After=${args.pod.podNetService}.service`
    : ''
}

[Container]
Label=pod=${args.pod.podName}
ContainerName=${containerName}
Image=${args.image}
${args.entrypoint ? pulumi.interpolate`Entrypoint=${args.entrypoint}\n` : ''}
${args.command ? pulumi.interpolate`Exec=${args.command}\n` : ''}

# Pod networking
${networkMode == 'pod' ? pulumi.interpolate`Network=${args.pod.podNetName}` : networkMode == 'host' ? 'Network=host' : ''}
${args.podDns ? pulumi.interpolate`DNS=${args.podDns}` : ''}

# Volume mounts
${mounts}

# Environment
${env}

# Direct port bindings
${ports}

# Additional Linux capabilities
${capabilities}

# Additional Linux devices
${devices}

${args.dnsSearchDomain ? pulumi.interpolate`DNSSearch=${args.dnsSearchDomain}\n` : ''}

[Service]
Restart=always

[Install]
WantedBy=multi-user.target default.target
`;

  return [
    ...systemd.sshActions({
      host: args.pod.host,
      name: pulumi.interpolate`${args.pod.podName}-${args.name}`,
      fileSuffix: '.container',
      unitFile: unit,
      unitDir: '/etc/containers/systemd',
      transient: true,
    }),
  ];
}
