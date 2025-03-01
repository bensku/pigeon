import * as pulumi from '@pulumi/pulumi';
import * as random from '@pulumi/random';
import * as host from '../host';
import * as systemd from '../systemd';
import * as ssh from '../ssh';
import { Pod } from './pod';

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
`,
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
  source: pulumi.Input<ssh.UploadSource>;
}

export class LocalFile extends pulumi.ComponentResource {
  readonly source: pulumi.Input<ssh.UploadSource>;
  readonly filePath: pulumi.Output<string>;

  constructor(
    name: string,
    args: LocalFileArgs,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super('pigeon:oci:LocalFile', name, args, opts);
    this.source = args.source;

    const id = new random.RandomUuid(`${name}-id`, {}, { parent: this });
    this.filePath = pulumi.interpolate`/var/pigeon/oci-uploads/${name}-${id.id}`;

    new ssh.RunActions(
      `${name}-upload`,
      {
        connection: args.pod.host.connection,
        actions: [
          {
            type: 'upload',
            source: this.source,
            remotePath: this.filePath,
          },
        ],
      },
      { parent: this, dependsOn: args.pod, deleteBeforeReplace: true },
    );
  }
}
