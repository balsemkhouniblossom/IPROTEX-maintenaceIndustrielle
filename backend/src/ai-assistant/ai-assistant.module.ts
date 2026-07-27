import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AiInteraction, AiInteractionSchema } from '../schemas/ai-interaction.schema';
import { Machine, MachineSchema } from '../schemas/machine.schema';
import { MachineType, MachineTypeSchema } from '../schemas/machine-type.schema';
import { Panne, PanneSchema } from '../schemas/panne.schema';
import { PanneSolution, PanneSolutionSchema } from '../schemas/panne-solution.schema';
import { FaultEvent, FaultEventSchema } from '../schemas/fault-event.schema';
import { WorkOrder, WorkOrderSchema } from '../schemas/work-order.schema';
import {
  InterventionReport,
  InterventionReportSchema,
} from '../schemas/intervention-report.schema';
import { DocumentsModule } from '../documents/documents.module';
import { KnowledgeBaseModule } from '../knowledge-base/knowledge-base.module';
import { AiAssistantController } from './ai-assistant.controller';
import { AiAssistantService } from './ai-assistant.service';
import { AiContextBuilderService } from './ai-context-builder.service';
import { PromptInjectionGuardService } from './prompt-injection-guard.service';
import { SensitiveDataFilterService } from './sensitive-data-filter.service';
import { AiAssistantThrottleService } from './ai-assistant-throttle.service';
import { AI_PROVIDER, AiProvider } from './ai-provider.interface';
import { NullAiProvider } from './providers/null-ai.provider';
import { AnthropicAiProvider } from './providers/anthropic-ai.provider';

function parseBoolean(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes((value ?? '').trim().toLowerCase());
}

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: AiInteraction.name, schema: AiInteractionSchema },
      { name: Machine.name, schema: MachineSchema },
      { name: MachineType.name, schema: MachineTypeSchema },
      { name: Panne.name, schema: PanneSchema },
      { name: PanneSolution.name, schema: PanneSolutionSchema },
      { name: FaultEvent.name, schema: FaultEventSchema },
      { name: WorkOrder.name, schema: WorkOrderSchema },
      { name: InterventionReport.name, schema: InterventionReportSchema },
    ]),
    DocumentsModule,
    KnowledgeBaseModule,
  ],
  controllers: [AiAssistantController],
  providers: [
    AiAssistantService,
    AiContextBuilderService,
    PromptInjectionGuardService,
    SensitiveDataFilterService,
    AiAssistantThrottleService,
    {
      provide: AI_PROVIDER,
      useFactory: (configService: ConfigService): AiProvider => {
        const enabled = parseBoolean(
          configService.get<string>('AI_ASSISTANT_ENABLED'),
        );
        const apiKey = configService.get<string>('ANTHROPIC_API_KEY')?.trim();

        if (!enabled || !apiKey) {
          return new NullAiProvider();
        }

        const model =
          configService.get<string>('AI_ASSISTANT_MODEL')?.trim() ||
          'claude-opus-4-8';
        const timeoutMs =
          Number(configService.get<string>('AI_ASSISTANT_TIMEOUT_MS')) || 12_000;

        return new AnthropicAiProvider({ apiKey, model, timeoutMs });
      },
      inject: [ConfigService],
    },
  ],
})
export class AiAssistantModule {}
