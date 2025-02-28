import * as pulumi from '@pulumi/pulumi';
import * as command from '@pulumi/command';
import * as ipam from '../ipam';
import { certManagerCmdLocal } from './cert-manager';

interface EndpointInputs {
  ipamConnection: pulumi.Unwrap<command.remote.CommandArgs['connection']>;
  networkId: string;
  networkPrefixLen: number;

  caKey: string;
  caCert: string;
  hostname: string;
  groups: string[];
}

interface EndpointOutputs extends EndpointInputs {
  endpointId: string;
  overlayIp: string;
  privateKey: string;
  certificate: string;
}

export class EndpointProvider
  implements pulumi.dynamic.ResourceProvider<EndpointInputs, EndpointOutputs>
{
  async create(inputs: EndpointInputs) {
    const endpointId = crypto.randomUUID();

    const overlayIp = await ipam.allocateAddressManual(
      inputs.ipamConnection,
      inputs.networkId,
      endpointId,
    );

    const privateKey = await certManagerCmdLocal({
      mode: 'host',
      target: 'key',
      caKey: inputs.caKey,
    });
    const certificate = await certManagerCmdLocal({
      mode: 'host',
      target: 'cert',
      caKey: inputs.caKey,
      caCert: inputs.caCert,
      hostKey: privateKey,
      certConfig: {
        hostname: inputs.hostname,
        network: `${overlayIp}/${inputs.networkPrefixLen}`,
        groups: inputs.groups,
        validNotBefore: new Date(0).toISOString(),
        validNotAfter: '2500-01-01T00:00:00.000Z',
      },
    });

    return {
      id: endpointId,
      outs: {
        ...inputs,

        endpointId,
        overlayIp,
        privateKey,
        certificate,
      },
    };
  }

  async diff(
    _id: string,
    oldOutputs: EndpointOutputs,
    newInputs: EndpointInputs,
  ) {
    const replaces = [
      'ipamConnection',
      'networkId',
      'networkPrefixLen',
      'caKey',
      'caCert',
      'hostname',
      'groups',
    ];
    let replace = false;
    for (const key of replaces) {
      // TODO normal deep equality check... ?
      if (JSON.stringify(oldOutputs[key]) !== JSON.stringify(newInputs[key])) {
        replace = true;
        break;
      }
    }
    return {
      changes: replace,
      replaces: replace ? replaces : [],
    };
  }

  async delete(id: string, inputs: EndpointOutputs) {
    await ipam.freeAddressManual(inputs.ipamConnection, inputs.networkId, id);
  }
}
