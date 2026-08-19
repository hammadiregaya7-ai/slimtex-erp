import { Controller, Get, Post, Put, Body, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { TenantService } from './tenant.service';

@ApiTags('tenants')
@Controller('tenants')
@ApiBearerAuth()
export class TenantController {
  constructor(private tenantService: TenantService) {}

  @Get()
  @ApiOperation({ summary: 'Get all tenants (admin only)' })
  findAll() {
    return this.tenantService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get tenant by ID' })
  findOne(@Param('id') id: string) {
    return this.tenantService.findOne(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update tenant settings' })
  update(@Param('id') id: string, @Body() data: any) {
    return this.tenantService.update(id, data);
  }
}
