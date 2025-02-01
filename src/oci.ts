import * as pulumi from '@pulumi/pulumi';
import * as host from './host';
import * as systemd from './systemd';

export interface PodArgs {
  host: host.Host;

  name: string;
}

export class Pod extends pulumi.ComponentResource {
  readonly host: host.Host;
  readonly podName: pulumi.Output<string>;
  readonly podNetName: pulumi.Output<string>;

  constructor(
    name: string,
    args: PodArgs,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super('pigeon:oci:Pod', name, args, opts);
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
}

export interface ContainerArgs {
  pod: Pod;
  name: string;
  image: string;
  mounts?: [pulumi.Input<string> | Volume, string][];
  environment?: [pulumi.Input<string>, pulumi.Input<string | SecretRef>][];
  ports?: [pulumi.Input<number>, pulumi.Input<number>][];
  entrypoint?: pulumi.Input<string>;
  command?: pulumi.Input<string>;
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
      (args.mounts ?? []).map(([volume, target]) => {
        const volumeName =
          volume instanceof Volume ? volume.volumeName : volume;
        return pulumi.interpolate`Volume=${volumeName}:${target}\n`;
      }),
    );

    // TODO consider escaping environment variables...
    const env = pulumi.concat(
      (args.environment ?? []).map(([key, value]) =>
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
      (args.ports ?? []).map(
        ([hostPort, containerPort]) =>
          pulumi.interpolate`PublishPort=${hostPort}:${containerPort}\n`,
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
${args.entrypoint ? pulumi.interpolate`Entrypoint=${args.entrypoint}\n` : ''}
${args.command ? pulumi.interpolate`Exec=${args.command}\n` : ''}

[Service]
Restart=always

[Install]
WantedBy=multi-user.target default.target
`;
    const service = new systemd.Service(
      `${name}-service`,
      {
        host: args.pod.host,
        name: pulumi.interpolate`${args.pod.podName}-${args.name}`,
        fileSuffix: '.container',
        unitFile: unit.apply((unit) => new pulumi.asset.StringAsset(unit)),
        unitDir: '/etc/containers/systemd',
        transient: true,
      },
      { parent: this, dependsOn: args.pod },
    );
    this.serviceName = service.serviceName;
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
