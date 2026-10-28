/** @format */

import { PinataSDK } from 'pinata';

interface FileMetadata {
  name?: string;
  keyvalues?: Record<string, string>;
}

const PINATA_JWT = import.meta.env.VITE_PINATA_JWT as string | undefined;
const GATEWAY_URL =
  (import.meta.env.VITE_GATEWAY_URL as string | undefined) || 'ipfs.io';

const mockCid = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `Qm${hex.slice(0, 44)}`;
};

export class PinataFileManager {
  private pinata: PinataSDK | null;
  private gateway: string;

  constructor() {
    this.gateway = GATEWAY_URL;
    this.pinata = PINATA_JWT
      ? new PinataSDK({
          pinataJwt: PINATA_JWT,
          pinataGateway: this.gateway,
        })
      : null;

    if (!this.pinata) {
      console.info('Pinata JWT not set — using local mock IPFS uploads');
    }
  }

  private requirePinata() {
    if (!this.pinata) {
      throw new Error('Pinata is not configured');
    }
    return this.pinata;
  }

  async uploadFile(
    file: File,
    network: 'public',
    metadata?: FileMetadata
  ): Promise<string> {
    if (!this.pinata) {
      return mockCid();
    }

    try {
      let uploadChain = network === 'public'
        ? this.pinata.upload.public.file(file)
        : undefined;

      if (metadata?.name && uploadChain) uploadChain = uploadChain.name(metadata.name);
      if (metadata?.keyvalues && uploadChain) uploadChain = uploadChain.keyvalues(metadata.keyvalues);

      const result = await uploadChain;
      return result?.cid || '';
    } catch (error) {
      console.error(`Error uploading file to ${network} IPFS:`, error);
      throw new Error(`Failed to upload file to ${network} IPFS`);
    }
  }

  async uploadFiles(
    files: File[],
    network: 'public' | 'private',
    metadata?: FileMetadata
  ): Promise<string[]> {
    if (!files.length) {
      throw new Error('Company metadata upload requires at least one document file');
    }

    if (!this.pinata) {
      return files.map(() => mockCid());
    }

    try {
      const pinata = this.requirePinata();
      return Promise.all(files.map((file) => {
        let fileChain = network === 'public'
          ? pinata.upload.public.file(file)
          : pinata.upload.private.file(file);

        fileChain = metadata?.name ? fileChain.name(metadata.name) : fileChain;
        fileChain = metadata?.keyvalues ? fileChain.keyvalues(metadata.keyvalues) : fileChain;

        return fileChain.then((result) => result.cid);
      }));
    } catch (error) {
      console.error(`IPFS upload failure: ${error instanceof Error ? error.message : 'Unknown error'}`, {
        network,
        fileCount: files.length,
        fileTypes: files.map((f) => f.type),
      });
      throw new Error(`IPFS upload failed: ${error instanceof Error ? error.message : 'Check console for details'}`);
    }
  }

  async uploadJSON(
    data: any,
    network: 'public' | 'private',
    metadata?: FileMetadata
  ): Promise<string> {
    if (!this.pinata) {
      return mockCid();
    }

    try {
      const pinata = this.requirePinata();
      let uploadChain = network === 'public'
        ? pinata.upload.public.json(data)
        : pinata.upload.private.json(data);

      if (metadata?.name) uploadChain = uploadChain.name(metadata.name);
      if (metadata?.keyvalues) uploadChain = uploadChain.keyvalues(metadata.keyvalues);

      const result = await uploadChain;
      return result.cid;
    } catch (error) {
      console.error(`Error uploading JSON to ${network} IPFS:`, error);
      throw new Error(`Failed to upload JSON to ${network} IPFS`);
    }
  }

  async listFiles(
    network: 'public' | 'private',
    _filters?: { status?: 'pinned' | 'unpinned' }
  ): Promise<any[]> {
    if (!this.pinata) {
      return [];
    }

    try {
      const result = network === 'public'
        ? await this.pinata.files.public.list()
        : await this.pinata.files.private.list();
      return result.files;
    } catch (error) {
      console.error(`Error listing ${network} files:`, error);
      throw new Error(`Failed to list ${network} files`);
    }
  }

  async updateFileMetadata(
    network: 'public' | 'private',
    fileId: string,
    metadata: FileMetadata
  ): Promise<void> {
    if (!this.pinata) {
      return;
    }

    try {
      const updateData = {
        id: fileId,
        name: metadata.name,
        keyvalues: metadata.keyvalues,
      };
      if (network === 'public') {
        await this.pinata.files.public.update(updateData);
      } else {
        await this.pinata.files.private.update(updateData);
      }
    } catch (error) {
      console.error(`Error updating ${network} file metadata:`, error);
      throw new Error(`Failed to update ${network} file metadata`);
    }
  }

  async deleteFile(network: 'public' | 'private', fileId: string): Promise<void> {
    if (!this.pinata) {
      return;
    }

    try {
      if (network === 'public') {
        await this.pinata.files.public.delete([fileId]);
      } else {
        await this.pinata.files.private.delete([fileId]);
      }
    } catch (error) {
      console.error(`Error deleting ${network} file:`, error);
      throw new Error(`Failed to delete ${network} file`);
    }
  }

  async getFileURL(cid: string, network: 'public' | 'private'): Promise<string> {
    if (!this.pinata) {
      return `https://${this.gateway}/ipfs/${cid}`;
    }

    try {
      const signedUrl = this.pinata.upload.public.createSignedURL({
        expires: 3600,
      });

      return signedUrl as unknown as string;
    } catch (error) {
      console.error(`Error generating ${network} file URL:`, error);
      throw new Error(`Failed to generate ${network} file URL`);
    }
  }
}
