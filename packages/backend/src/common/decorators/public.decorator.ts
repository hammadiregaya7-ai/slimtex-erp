import { SetMetadata } from '@nestjs/common';

export const TENANT_ID_KEY = 'tenantId';
export const Public = () => SetMetadata('isPublic', true);
