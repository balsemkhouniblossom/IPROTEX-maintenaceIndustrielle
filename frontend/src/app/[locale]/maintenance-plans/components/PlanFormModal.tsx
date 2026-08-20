import { useTranslations } from 'next-intl';
import { Modal } from '@/components/Modal';
import { MaintenancePlan, ModuleEntity } from '../types';
import {
  CUSTOM_OPTION,
  DOCUMENTATION_OPTIONS,
  FREQUENCE_OPTIONS,
  FREQUENCE_UNIT_OPTIONS,
  HUILE_GRAISSE_OPTIONS,
  INSTRUCTION_OPTIONS,
  MAINTENANCE_TYPE_OPTIONS,
  RESPONSABLE_OPTIONS,
  cleanInstruction,
  cleanResponsable,
  getModuleLabel,
  getNextFieldValue,
  getSelectValue,
} from '../utils';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { renderWidgetErrorFallback } from '@/components/WidgetErrorFallback';

export type PlanFormData = {
  plan_id: string;
  module_id: string;
  type_maintenance: string;
  frequence: string;
  unite_frequence: string;
  maintenance_code: string;
  frequence_label: string;
  instruction: string;
  responsable: string;
  huile_graisse: string;
  documentation: string;
};

type PlanFormModalProps = Readonly<{
  isOpen: boolean;
  editingPlan: MaintenancePlan | null;
  formData: PlanFormData;
  setFormData: (updater: (prev: PlanFormData) => PlanFormData) => void;
  submitting: boolean;
  modules: ModuleEntity[];
  planIdOptions: string[];
  maintenanceCodeOptions: string[];
  frequenceLabelOptions: string[];
  onClose: () => void;
  onSubmit: (event: React.FormEvent) => void;
  t: ReturnType<typeof useTranslations>;
  tCommon: ReturnType<typeof useTranslations>;
}>;

export function PlanFormModal(props: PlanFormModalProps) {
  return (
    <ErrorBoundary boundaryName="plan-form-modal" fallback={renderWidgetErrorFallback}>
      <PlanFormModalInner {...props} />
    </ErrorBoundary>
  );
}

function PlanFormModalInner({
  isOpen,
  editingPlan,
  formData,
  setFormData,
  submitting,
  modules,
  planIdOptions,
  maintenanceCodeOptions,
  frequenceLabelOptions,
  onClose,
  onSubmit,
  t,
  tCommon,
}: PlanFormModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={editingPlan ? t('modal.edit') : t('modal.add')}>
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label htmlFor="plan-form-plan-id" className="block text-sm font-medium text-slate-700 mb-1">{t('form.planCode', { default: 'Plan Code' })}</label>
          <select
            id="plan-form-plan-id"
            value={getSelectValue(planIdOptions, formData.plan_id)}
            onChange={(event) =>
              setFormData((prev) => ({
                ...prev,
                plan_id: getNextFieldValue(planIdOptions, prev.plan_id, event.target.value),
              }))
            }
            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            title={t('form.planCode', { default: 'Plan Code' })}
            required
          >
            <option value="">{t('placeholders.planCode', { default: 'Select plan code' })}</option>
            {planIdOptions.map((planId) => (
              <option key={planId} value={planId}>
                {planId}
              </option>
            ))}
            <option value={CUSTOM_OPTION}>{t('custom')}</option>
          </select>
          {getSelectValue(planIdOptions, formData.plan_id) === CUSTOM_OPTION && (
            <input
              type="text"
              value={formData.plan_id}
              onChange={(event) => setFormData((prev) => ({ ...prev, plan_id: event.target.value }))}
              className="mt-2 w-full px-3 py-2 border border-gray-300 rounded-lg"
              placeholder={t('placeholders.planCode', { default: 'Enter plan code' })}
              required
            />
          )}
        </div>

        <div>
          <label htmlFor="plan-form-module-id" className="block text-sm font-medium text-slate-700 mb-1">{t('form.module')}</label>
          <select
            id="plan-form-module-id"
            value={formData.module_id}
            onChange={(event) => setFormData((prev) => ({ ...prev, module_id: event.target.value }))}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            title={t('form.module')}
            required
          >
            <option value="">{t('placeholders.module')}</option>
            {(Array.isArray(modules) ? modules : []).map((module) => (
              <option key={module._id} value={module._id}>
                {getModuleLabel(module, modules, tCommon('notAvailable'))}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="plan-form-type-maintenance" className="block text-sm font-medium text-slate-700 mb-1">{t('form.maintenanceType')}</label>
            <select
              id="plan-form-type-maintenance"
              value={getSelectValue(MAINTENANCE_TYPE_OPTIONS, formData.type_maintenance)}
              onChange={(event) =>
                setFormData((prev) => ({
                  ...prev,
                  type_maintenance: getNextFieldValue(MAINTENANCE_TYPE_OPTIONS, prev.type_maintenance, event.target.value),
                }))
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              title={t('form.maintenanceType')}
              required
            >
              {MAINTENANCE_TYPE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
              <option value={CUSTOM_OPTION}>{t('custom')}</option>
            </select>
            {getSelectValue(MAINTENANCE_TYPE_OPTIONS, formData.type_maintenance) === CUSTOM_OPTION && (
              <input
                type="text"
                value={formData.type_maintenance}
                onChange={(event) => setFormData((prev) => ({ ...prev, type_maintenance: event.target.value }))}
                className="mt-2 w-full px-3 py-2 border border-gray-300 rounded-lg"
                placeholder={t('placeholders.maintenanceType')}
                required
              />
            )}
          </div>
          <div>
            <label htmlFor="plan-form-frequence" className="block text-sm font-medium text-slate-700 mb-1">{t('form.frequency')}</label>
            <select
              id="plan-form-frequence"
              value={getSelectValue(FREQUENCE_OPTIONS, formData.frequence)}
              onChange={(event) =>
                setFormData((prev) => ({
                  ...prev,
                  frequence: getNextFieldValue(FREQUENCE_OPTIONS, prev.frequence, event.target.value),
                }))
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              title={t('form.frequency')}
              required
            >
              {FREQUENCE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
              <option value={CUSTOM_OPTION}>{t('custom')}</option>
            </select>
            {getSelectValue(FREQUENCE_OPTIONS, formData.frequence) === CUSTOM_OPTION && (
              <input
                type="number"
                min="1"
                value={formData.frequence}
                onChange={(event) => setFormData((prev) => ({ ...prev, frequence: event.target.value }))}
                className="mt-2 w-full px-3 py-2 border border-gray-300 rounded-lg"
                placeholder={t('placeholders.frequency')}
                required
              />
            )}
          </div>
        </div>

        <div>
          <label htmlFor="plan-form-unite-frequence" className="block text-sm font-medium text-slate-700 mb-1">{t('form.frequencyUnit')}</label>
          <select
            id="plan-form-unite-frequence"
            value={getSelectValue(FREQUENCE_UNIT_OPTIONS, formData.unite_frequence)}
            onChange={(event) =>
              setFormData((prev) => ({
                ...prev,
                unite_frequence: getNextFieldValue(FREQUENCE_UNIT_OPTIONS, prev.unite_frequence, event.target.value),
              }))
            }
            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            title={t('form.frequencyUnit')}
            required
          >
            {FREQUENCE_UNIT_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
            <option value={CUSTOM_OPTION}>{t('custom')}</option>
          </select>
          {getSelectValue(FREQUENCE_UNIT_OPTIONS, formData.unite_frequence) === CUSTOM_OPTION && (
            <input
              type="text"
              value={formData.unite_frequence}
              onChange={(event) => setFormData((prev) => ({ ...prev, unite_frequence: event.target.value }))}
              className="mt-2 w-full px-3 py-2 border border-gray-300 rounded-lg"
              placeholder={t('placeholders.frequencyUnit')}
              required
            />
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="plan-form-maintenance-code" className="block text-sm font-medium text-slate-700 mb-1">{t('form.maintenanceCode')}</label>
            <select
              id="plan-form-maintenance-code"
              value={getSelectValue(maintenanceCodeOptions, formData.maintenance_code)}
              onChange={(event) =>
                setFormData((prev) => ({
                  ...prev,
                  maintenance_code: getNextFieldValue(maintenanceCodeOptions, prev.maintenance_code, event.target.value),
                }))
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              title={t('form.maintenanceCode')}
            >
              <option value="">{t('placeholders.maintenanceCode')}</option>
              {maintenanceCodeOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
              <option value={CUSTOM_OPTION}>{t('custom')}</option>
            </select>
            {getSelectValue(maintenanceCodeOptions, formData.maintenance_code) === CUSTOM_OPTION && (
              <input
                type="text"
                value={formData.maintenance_code}
                onChange={(event) => setFormData((prev) => ({ ...prev, maintenance_code: event.target.value }))}
                className="mt-2 w-full px-3 py-2 border border-gray-300 rounded-lg"
                placeholder={t('placeholders.maintenanceCode')}
              />
            )}
          </div>
          <div>
            <label htmlFor="plan-form-frequence-label" className="block text-sm font-medium text-slate-700 mb-1">{t('form.frequencyLabel')}</label>
            <select
              id="plan-form-frequence-label"
              value={getSelectValue(frequenceLabelOptions, formData.frequence_label)}
              onChange={(event) =>
                setFormData((prev) => ({
                  ...prev,
                  frequence_label: getNextFieldValue(frequenceLabelOptions, prev.frequence_label, event.target.value),
                }))
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              title={t('form.frequencyLabel')}
            >
              <option value="">{t('placeholders.frequencyLabel')}</option>
              {frequenceLabelOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
              <option value={CUSTOM_OPTION}>{t('custom')}</option>
            </select>
            {getSelectValue(frequenceLabelOptions, formData.frequence_label) === CUSTOM_OPTION && (
              <input
                type="text"
                value={formData.frequence_label}
                onChange={(event) => setFormData((prev) => ({ ...prev, frequence_label: event.target.value }))}
                className="mt-2 w-full px-3 py-2 border border-gray-300 rounded-lg"
                placeholder={t('placeholders.frequencyLabel')}
              />
            )}
          </div>
        </div>

        <div>
          <label htmlFor="plan-form-responsable" className="block text-sm font-medium text-slate-700 mb-1">{t('form.responsable')}</label>
          <select
            id="plan-form-responsable"
            value={getSelectValue(RESPONSABLE_OPTIONS, formData.responsable)}
            onChange={(event) =>
              setFormData((prev) => ({
                ...prev,
                responsable: getNextFieldValue(RESPONSABLE_OPTIONS, prev.responsable, event.target.value),
              }))
            }
            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            title={t('form.responsable')}
          >
            <option value="">{t('placeholders.responsable')}</option>
            {RESPONSABLE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
            <option value={CUSTOM_OPTION}>{t('custom')}</option>
          </select>
          {getSelectValue(RESPONSABLE_OPTIONS, formData.responsable) === CUSTOM_OPTION && (
            <input
              type="text"
              value={formData.responsable}
              onChange={(event) => setFormData((prev) => ({ ...prev, responsable: cleanResponsable(event.target.value) }))}
              className="mt-2 w-full px-3 py-2 border border-gray-300 rounded-lg"
              placeholder={t('placeholders.responsable')}
            />
          )}
        </div>

        <div>
          <label htmlFor="plan-form-huile-graisse" className="block text-sm font-medium text-slate-700 mb-1">{t('form.huileGraisse')}</label>
          <select
            id="plan-form-huile-graisse"
            value={getSelectValue(HUILE_GRAISSE_OPTIONS, formData.huile_graisse)}
            onChange={(event) =>
              setFormData((prev) => ({
                ...prev,
                huile_graisse: getNextFieldValue(HUILE_GRAISSE_OPTIONS, prev.huile_graisse, event.target.value),
              }))
            }
            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            title={t('form.huileGraisse')}
          >
            <option value="">{t('placeholders.huileGraisse')}</option>
            {HUILE_GRAISSE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
            <option value={CUSTOM_OPTION}>{t('custom')}</option>
          </select>
          {getSelectValue(HUILE_GRAISSE_OPTIONS, formData.huile_graisse) === CUSTOM_OPTION && (
            <input
              type="text"
              value={formData.huile_graisse}
              onChange={(event) => setFormData((prev) => ({ ...prev, huile_graisse: event.target.value }))}
              className="mt-2 w-full px-3 py-2 border border-gray-300 rounded-lg"
              placeholder={t('placeholders.huileGraisse')}
            />
          )}
        </div>

        <div>
          <label htmlFor="plan-form-documentation" className="block text-sm font-medium text-slate-700 mb-1">{t('form.documentation')}</label>
          <select
            id="plan-form-documentation"
            value={getSelectValue(DOCUMENTATION_OPTIONS, formData.documentation)}
            onChange={(event) =>
              setFormData((prev) => ({
                ...prev,
                documentation: getNextFieldValue(DOCUMENTATION_OPTIONS, prev.documentation, event.target.value),
              }))
            }
            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            title={t('form.documentation')}
          >
            <option value="">{t('placeholders.documentation')}</option>
            {DOCUMENTATION_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
            <option value={CUSTOM_OPTION}>{t('custom')}</option>
          </select>
          {getSelectValue(DOCUMENTATION_OPTIONS, formData.documentation) === CUSTOM_OPTION && (
            <input
              type="text"
              value={formData.documentation}
              onChange={(event) => setFormData((prev) => ({ ...prev, documentation: event.target.value }))}
              className="mt-2 w-full px-3 py-2 border border-gray-300 rounded-lg"
              placeholder={t('placeholders.documentation')}
            />
          )}
        </div>

        <div>
          <label htmlFor="plan-form-instruction" className="block text-sm font-medium text-slate-700 mb-1">{t('form.instruction')}</label>
          <select
            id="plan-form-instruction"
            value={getSelectValue(INSTRUCTION_OPTIONS, formData.instruction)}
            onChange={(event) =>
              setFormData((prev) => ({
                ...prev,
                instruction: getNextFieldValue(INSTRUCTION_OPTIONS, prev.instruction, event.target.value),
              }))
            }
            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            title={t('form.instruction')}
          >
            <option value="">{t('placeholders.instruction')}</option>
            {INSTRUCTION_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
            <option value={CUSTOM_OPTION}>{t('custom')}</option>
          </select>
          {getSelectValue(INSTRUCTION_OPTIONS, formData.instruction) === CUSTOM_OPTION && (
            <textarea
              rows={5}
              value={formData.instruction}
              onChange={(event) => setFormData((prev) => ({ ...prev, instruction: cleanInstruction(event.target.value) }))}
              className="mt-2 w-full px-3 py-2 border border-gray-300 rounded-lg"
              placeholder={t('placeholders.instruction')}
            />
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            {t('actions.cancel')}
          </button>
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? tCommon('saving') : editingPlan ? t('actions.update') : t('actions.create')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
