import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { EmailService } from '../email/email.service';

@Injectable()
export class HealthService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly emailService: EmailService,
  ) {}

  getApiHealth() {
    return {
      status: 'ok',
      service: 'api',
      timestamp: new Date().toISOString(),
    };
  }

  async getDatabaseHealth() {
    const startedAt = Date.now();
    if (!this.connection.db) {
      throw new Error('Database connection is not ready');
    }

    await this.connection.db.admin().ping();

    return {
      status: 'ok',
      service: 'database',
      responseTimeMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    };
  }

  async getEmailHealth() {
    return this.emailService.getDiagnostics();
  }

  async getHealth() {
    const [api, database, email] = await Promise.all([
      Promise.resolve(this.getApiHealth()),
      this.getDatabaseHealth(),
      this.getEmailHealth(),
    ]);

    const aggregateStatus =
      database.status === 'ok' && email.status === 'ok' ? 'ok' : 'degraded';

    return {
      status: aggregateStatus,
      timestamp: new Date().toISOString(),
      checks: {
        api,
        database,
        email,
      },
    };
  }

  async getPublicHealth() {
    const [api, database] = await Promise.all([
      Promise.resolve(this.getApiHealth()),
      this.getDatabaseHealth(),
    ]);

    return {
      status: database.status === 'ok' ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      checks: {
        api: {
          status: api.status,
          service: api.service,
        },
        database: {
          status: database.status,
          service: database.service,
        },
      },
    };
  }
}
