import { Global, Module } from '@nestjs/common';
import { DocumentArtifactService } from './document-artifact.service';
import { ProfileImageStorageService } from './profile-image-storage.service';
import { StoragePathService } from './storage-path.service';

@Global()
@Module({
  providers: [
    StoragePathService,
    ProfileImageStorageService,
    DocumentArtifactService,
  ],
  exports: [
    StoragePathService,
    ProfileImageStorageService,
    DocumentArtifactService,
  ],
})
export class StorageModule {}
