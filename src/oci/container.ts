import * as pulumi from '@pulumi/pulumi';
import * as systemd from '../systemd';
import { Pod } from './pod';
import { LocalFile, Volume } from './volume';

export interface ContainerArgs {
  pod: Pod;
  name: pulumi.Input<string>;
  image: string;
  mounts?: [pulumi.Input<string> | Volume | LocalFile, string][];
  environment?: [pulumi.Input<string>, pulumi.Input<string | SecretRef>][];
  entrypoint?: pulumi.Input<string>;
  command?: pulumi.Input<string>;
  linuxCapabilities?: string[];
  linuxDevices?: string[];

  networkMode?: 'pod' | 'bridge' | 'host';
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
ContainerName=${this.containerName}
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
    // Make sure pod and volumes exist before we bring up the container
    // Also, if we're uploading a local file, make service dependent on it
    const dependsOn: pulumi.Resource[] = [args.pod];
    const triggers: pulumi.Input<pulumi.asset.Asset>[] = [];
    for (const [volume] of args.mounts ?? []) {
      if (volume instanceof Volume || volume instanceof LocalFile) {
        dependsOn.push(volume);
      }
      if (volume instanceof LocalFile) {
        triggers.push(volume);
      }
    }

    const service = new systemd.Service(
      `${name}-service`,
      {
        host: args.pod.host,
        name: pulumi.interpolate`${args.pod.podName}-${args.name}`,
        fileSuffix: '.container',
        unitFile: unit,
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
