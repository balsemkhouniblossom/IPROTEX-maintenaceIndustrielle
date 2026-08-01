import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import {
  AiInteraction,
  AiInteractionSchema,
} from '../schemas/ai-interaction.schema';
import { Machine, MachineSchema } from '../schemas/machine.schema';
import { MachineType, MachineTypeSchema } from '../schemas/machine-type.schema';
import { Panne, PanneSchema } from '../schemas/panne.schema';
import {
  PanneSolution,
  PanneSolutionSchema,
} from '../schemas/panne-solution.schema';
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
import {
  GeminiAiProvider,
  MisconfiguredAiProvider,
} from './providers/gemini-ai.provider';

function parseBoolean(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes(
    (value ?? '').trim().toLowerCase(),
  );
}

const aiProviderLogger = new Logger('AiAssistantProvider');

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

        if (!enabled) {
          aiProviderLogger.warn(
            'AI assistant disabled: AI_ASSISTANT_ENABLED is not true',
          );
          return new NullAiProvider();
        }

        const provider =
          configService
            .get<string>('AI_ASSISTANT_PROVIDER')
            ?.trim()
            .toLowerCase() || 'gemini';
        if (provider !== 'gemini') {
          aiProviderLogger.error(
            `AI assistant misconfigured: unsupported provider "${provider}"`,
          );
          return new MisconfiguredAiProvider(
            'invalid_provider',
            'AI_ASSISTANT_PROVIDER must be "gemini"',
          );
        }

        const apiKey = configService.get<string>('GEMINI_API_KEY')?.trim();
        const model = configService.get<string>('GEMINI_MODEL')?.trim();

        if (!apiKey || !model) {
          aiProviderLogger.error(
            `AI assistant misconfigured: missing ${!apiKey ? 'GEMINI_API_KEY' : ''}${!apiKey && !model ? ' and ' : ''}${!model ? 'GEMINI_MODEL' : ''}`,
          );
          return new MisconfiguredAiProvider(
            'gemini',
            'GEMINI_API_KEY and GEMINI_MODEL are required when AI assistant is enabled',
          );
        }

        aiProviderLogger.log(
          `AI assistant enabled with provider gemini and model ${model}`,
        );
        return new GeminiAiProvider({ apiKey, model });
      },
      inject: [ConfigService],
    },
  ],
})
export class AiAssistantModule {}
