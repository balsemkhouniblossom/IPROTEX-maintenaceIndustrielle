import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { DevicesService } from './devices.service';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { UpdateDeviceDto } from './dto/update-device.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminOnly } from '../auth/decorators/roles.decorator';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request';

/**
 * Admin-only device registration/management, authenticated exactly like
 * every other user-facing controller (`JwtAuthGuard` + `@AdminOnly()`).
 * The raw API key is only ever present in the response of `register`/
 * `rotateKey` — it is never stored in plaintext and never returned again.
 */
@Controller('devices')
@UseGuards(JwtAuthGuard)
@AdminOnly()
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @Post()
  register(@Body() dto: RegisterDeviceDto, @Req() req: AuthenticatedRequest) {
    return this.devicesService.register(dto, req.user?.userId);
  }

  @Get()
  findAll() {
    return this.devicesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.devicesService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateDeviceDto) {
    return this.devicesService.update(id, dto);
  }

  @Post(':id/rotate-key')
  rotateKey(@Param('id') id: string) {
    return this.devicesService.rotateKey(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.devicesService.remove(id);
  }
}
