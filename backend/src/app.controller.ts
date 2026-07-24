import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { AuthenticatedRoles } from './auth/decorators/roles.decorator';

@Controller()
@AuthenticatedRoles()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getApiIndex() {
    return this.appService.getApiIndex();
  }
}
