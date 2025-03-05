import * as pulumi from '@pulumi/pulumi';
import stringify from 'json-stable-stringify';
import * as oci from '../oci';
import * as ssh from '../ssh';
import * as systemd from '../systemd';
import { Endpoint, EndpointArgs } from './endpoint';
import { composeConfig } from './nebula-config';

export interface PodAttachmentArgs {
  /**
   * Endpoint to attach to a pod.
   */
  endpoint: Endpoint;

  /**
   * Pod to attach the endpoint to.
   */
  pod: oci.Pod;

  lighthouse?: boolean;
  underlayPort?: pulumi.Output<number>;
}

export class PodAttachment
  extends pulumi.ComponentResource
  implements oci.PodAttachment
{
  readonly endpoint: Endpoint;
  readonly underlayPort: pulumi.Output<number>;

  constructor(
    name: string,
    args: PodAttachmentArgs,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super('pigeon:flock:PodAttachment', name, args, opts);
    this.endpoint = args.endpoint;
    this.underlayPort = args.underlayPort ?? pulumi.output(0);

    const nebulaConfig = composeConfig(this.endpoint, {
      isLighthouse: args.lighthouse ?? false,
      underlayPort: this.underlayPort,
    });

    // Do host-specific setup - once per host
    const hostSetup = args.pod.host.addSetupTask(
      'flock-pod-utils',
      (host, name) =>
        new ssh.RunActions(
          name,
          {
            connection: host.connection,
            actions: [
              {
                type: 'upload',
                source: { localPath: 'scripts/nebula_nic.sh' },
                remotePath: '/opt/pigeon/nebula_nic.sh',
              },
              {
                type: 'command',
                create: 'chmod +x /opt/pigeon/nebula_nic.sh',
              },
            ],
          },
          { dependsOn: host, deleteBeforeReplace: true },
        ),
    );

    // Deploy networking as a set of systemd services
    const containerName = pulumi.interpolate`nebula-${args.endpoint.network.networkId}`;
    const fullName = pulumi.interpolate`${args.pod.podName}-${containerName}`;
    const nebulaConfigPath = pulumi.interpolate`/var/pigeon/oci-uploads/${fullName}.json`;
    new ssh.RunActions(
      `${name}-nebula`,
      {
        connection: args.pod.host.connection,
        actions: [
          // Copy Nebula config to host
          {
            type: 'upload',
            source: nebulaConfig.apply((cfg) => stringify(cfg)!),
            remotePath: nebulaConfigPath,
          },
          // Launch Nebula container in pod, but with host network!
          ...oci.containerSshActions({
            pod: args.pod,
            image: 'docker.io/nebulaoss/nebula:1.9.5', // TODO don't hardcode
            name: containerName,
            networkMode: 'host',
            mounts: [[nebulaConfigPath, '/config/config.yml']], // It is actually JSON, but this is the expected path
            linuxCapabilities: ['NET_ADMIN'],
            linuxDevices: ['/dev/net/tun'],
          }),
          // If this is not a lighthouse, move Nebula TUN to pod network
          // Lighthouses need to serve DNS traffic within host network namespace
          ...(args.lighthouse
            ? []
            : systemd.sshActions({
                host: args.pod.host,
                name: pulumi.interpolate`${fullName}-netns`,
                unitFile: netNsMover(
                  args.pod.podNetService,
                  fullName,
                  nebulaConfig.apply((cfg) => cfg.tun.dev),
                ),
              })),
        ],
      },
      { parent: this, dependsOn: hostSetup, deleteBeforeReplace: true },
    );
  }

  get ipAddress(): pulumi.Output<string> {
    return this.endpoint.overlayIp;
  }
}

function netNsMover(
  containerName: pulumi.Input<string>,
  serviceName: pulumi.Input<string>,
  nicId: pulumi.Input<string>,
) {
  return pulumi.interpolate`[Unit]
Description=Move Nebula TUN to container network
Requires=${serviceName}.service
After=${serviceName}.service

[Service]
Type=oneshot
ExecStart=/opt/pigeon/nebula_nic.sh ${containerName} ${nicId}
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target`;
}
