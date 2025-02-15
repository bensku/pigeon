import * as pulumi from '@pulumi/pulumi';
import * as random from '@pulumi/random';
import * as host from './host';
import * as systemd from './systemd';

export interface PodArgs {
  host: host.Host;

  name: string;
}

export class Pod extends pulumi.ComponentResource {
  readonly name: string;
  readonly host: host.Host;
  readonly podName: pulumi.Output<string>;
  readonly podNetName: pulumi.Output<string>;

  readonly containers: Container[] = [];
  readonly dnsResolvers: pulumi.Output<string>[] = [];

  constructor(
    name: string,
    args: PodArgs,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super('pigeon:oci:Pod', name, args, opts);
    this.name = name;
    this.host = args.host;
    this.podName = pulumi.output(args.name);

    // Ensure container runtime is installed before we proceed any further
    const runtimeInstall = this.host.installPackage('podman');

    // Create pod network
    this.podNetName = pulumi.interpolate`${args.name}-pod.network`;
    new systemd.Service(
      `${name}-pod-net`,
      {
        host: args.host,
        name: `${args.name}-pod`,
        serviceSuffix: '-network',
        fileSuffix: '.network',
        unitFile: new pulumi.asset.StringAsset(`[Unit]
Description=Pod network for ${args.name}

[Network]
Label=pod=${args.name}

[Install]
WantedBy=multi-user.target default.target
`),
        unitDir: '/etc/containers/systemd',
        transient: true,
      },
      { parent: this, dependsOn: [args.host, runtimeInstall] },
    );
  }

  addDnsResolver(resolver: pulumi.Input<string>) {
    if (this.containers.length > 0) {
      throw new Error('DNS resolvers must be added to pod before containers');
    }
    this.dnsResolvers.push(pulumi.output(resolver));
  }
}

export interface ContainerArgs {
  pod: Pod;
  name: string;
  image: string;
  mounts?: [pulumi.Input<string> | Volume | LocalFile, string][];
  environment?: [pulumi.Input<string>, pulumi.Input<string | SecretRef>][];
  ports?: [pulumi.Input<number>, pulumi.Input<number>, ('tcp' | 'udp')?][];
  entrypoint?: pulumi.Input<string>;
  command?: pulumi.Input<string>;
  linuxCapabilities?: string[];
  linuxDevices?: string[];
  disablePodDns?: boolean;
  dnsSearchDomain?: pulumi.Input<string>;
}

interface SecretRef {
  secretName: string;
}

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
      ...(args.ports ?? []).map(
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

    const dnsResolvers = args.disablePodDns
      ? ''
      : pulumi.concat(
          ...args.pod.dnsResolvers.map(
            (resolver) => pulumi.interpolate`DNS=${resolver}\n`,
          ),
        );

    const unit = pulumi.interpolate`[Unit]
Description=Container ${args.name} in pod ${args.pod.podName}

[Container]
Label=pod=${args.pod.podName}
ContainerName=${this.containerName}
Image=${args.image}
Network=${args.pod.podNetName}
${mounts}
${env}
${ports}
${capabilities}
${devices}
${dnsResolvers}
${args.dnsSearchDomain ? pulumi.interpolate`DNSSearch=${args.dnsSearchDomain}\n` : ''}
${args.entrypoint ? pulumi.interpolate`Entrypoint=${args.entrypoint}\n` : ''}
${args.command ? pulumi.interpolate`Exec=${args.command}\n` : ''}

[Service]
Restart=always

[Install]
WantedBy=multi-user.target default.target
`;
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

    const service = new systemd.Service(
      `${name}-service`,
      {
        host: args.pod.host,
        name: pulumi.interpolate`${args.pod.podName}-${args.name}`,
        fileSuffix: '.container',
        unitFile: unit.apply((unit) => new pulumi.asset.StringAsset(unit)),
        unitDir: '/etc/containers/systemd',
        transient: true,
        triggers,
      },
      { parent: this, dependsOn },
    );
    this.serviceName = service.serviceName;
    args.pod.containers.push(this);
  }
}

export interface VolumeArgs {
  pod: Pod;
  name: string;
}

export class Volume extends pulumi.ComponentResource {
  readonly volumeName: pulumi.Output<string>;
  readonly serviceName: pulumi.Output<string>;

  constructor(
    name: string,
    args: VolumeArgs,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super('pigeon:oci:Volume', name, args, opts);
    this.volumeName = pulumi.interpolate`${args.pod.podName}-${args.name}.volume`;

    const service = new systemd.Service(
      `${name}-service`,
      {
        host: args.pod.host,
        name: pulumi.interpolate`${args.pod.podName}-${args.name}`,
        serviceSuffix: '-volume',
        fileSuffix: '.volume',
        unitFile: pulumi.interpolate`[Unit]
Description=Volume ${args.name} in pod ${args.pod.podName}

[Volume]
Label=pod=${args.name}

[Install]
WantedBy=multi-user.target default.target
`.apply((unit) => new pulumi.asset.StringAsset(unit)),
        unitDir: '/etc/containers/systemd',
        transient: true,
      },
      { parent: this, dependsOn: args.pod },
    );
    this.serviceName = service.serviceName;
  }
}

export interface LocalFileArgs {
  /**
   * Pod whose containers might mount this file.
   */
  pod: Pod;

  /**
   * Source for the file. Can be a local file or in-memory asset.
   * The content will be uploaded to a temporary location.
   */
  source: pulumi.Input<pulumi.asset.Asset>;
}

export class LocalFile extends pulumi.ComponentResource {
  readonly source: pulumi.Input<pulumi.asset.Asset>;
  readonly filePath: pulumi.Output<string>;

  constructor(
    name: string,
    args: LocalFileArgs,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super('pigeon:oci:MountedFile', name, args, opts);
    this.source = args.source;

    const id = new random.RandomUuid(`${name}-id`, {}, { parent: this });
    this.filePath = pulumi.interpolate`/var/pigeon/oci-uploads/${name}-${id.id}`;

    new host.FileUpload(
      `${name}-upload`,
      {
        host: args.pod.host,
        source: args.source,
        remotePath: this.filePath,
      },
      { parent: this, dependsOn: args.pod },
    );
  }
}
