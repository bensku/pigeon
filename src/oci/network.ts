import * as pulumi from '@pulumi/pulumi';
import { Pod, PodNetwork } from './pod';

export interface PodNetworkProvider<T> {
  /**
   * Unique id of this network.
   */
  get networkId(): pulumi.Input<string>;

  /**
   * Attachs a pod to this network.
   * @param pod Pod to attach.
   * @returns Pod attachment.
   */
  attachPod(pod: Pod, args: T): PodAttachment;

  /**
   * Gets DNS servers of this network for the given pod. Not all pods need to
   * use same DNS servers.
   * @param pod Attached pod.
   */
  dnsServers(pod: Pod): pulumi.Input<string>[];

  /**
   * Gets DNS domain of this network.
   *
   * @example Given DNS domain "pigeon.internal", pod with name "foo" will
   * have DNS name of "foo.pigeon.internal". Network's DNS servers MUST
   * recognize it by that name!
   */
  get dnsDomain(): pulumi.Input<string>;
}

export interface PodAttachment {
  get ipAddress(): pulumi.Input<string>;
}

/**
 * Host NAT network. Adding this allows the pod to communicate with outside
 * world. Port bindings fail if this network is not present.
 */
export const HOST_NAT: PodNetwork<{ hostname: string }> = {
  config: {
    hostname: 'unknown',
  },
  network: {
    networkId: 'host-nat',
    attachPod: () => ({ ipAddress: 'unknown' }),
    dnsServers: () => [],
    dnsDomain: '',
  },
};
