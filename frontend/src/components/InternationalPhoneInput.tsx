'use client';

import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDownIcon } from '@heroicons/react/24/outline';
import TNFlag from 'country-flag-icons/react/3x2/TN';
import FRFlag from 'country-flag-icons/react/3x2/FR';
import DEFlag from 'country-flag-icons/react/3x2/DE';
import ITFlag from 'country-flag-icons/react/3x2/IT';
import ESFlag from 'country-flag-icons/react/3x2/ES';
import GBFlag from 'country-flag-icons/react/3x2/GB';
import USFlag from 'country-flag-icons/react/3x2/US';
import CAFlag from 'country-flag-icons/react/3x2/CA';
import MAFlag from 'country-flag-icons/react/3x2/MA';
import DZFlag from 'country-flag-icons/react/3x2/DZ';
import BEFlag from 'country-flag-icons/react/3x2/BE';
import CHFlag from 'country-flag-icons/react/3x2/CH';
import {
  formatNationalPhone,
  PHONE_COUNTRY_OPTIONS,
  PhoneCountryCode,
  PhoneInputValue,
} from '@/services/phoneNumber';

const FLAG_COMPONENT_BY_COUNTRY = {
  TN: TNFlag,
  FR: FRFlag,
  DE: DEFlag,
  IT: ITFlag,
  ES: ESFlag,
  GB: GBFlag,
  US: USFlag,
  CA: CAFlag,
  MA: MAFlag,
  DZ: DZFlag,
  BE: BEFlag,
  CH: CHFlag,
} satisfies Record<PhoneCountryCode, typeof TNFlag>;

interface InternationalPhoneInputProps {
  value: PhoneInputValue;
  onChange: (value: PhoneInputValue) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
  selectClassName?: string;
  name?: string;
  autoComplete?: string;
}

export default function InternationalPhoneInput({
  value,
  onChange,
  placeholder = 'Local number',
  disabled = false,
  className = '',
  inputClassName = '',
  selectClassName = '',
  name,
  autoComplete = 'tel-national',
}: InternationalPhoneInputProps) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const formattedValue = formatNationalPhone(value.country, value.nationalNumber);
  const selectedOption = useMemo(
    () => PHONE_COUNTRY_OPTIONS.find((option) => option.country === value.country) ?? PHONE_COUNTRY_OPTIONS[0],
    [value.country],
  );

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleCountryChange = (nextCountry: PhoneCountryCode) => {
    onChange({
      country: nextCountry,
      nationalNumber: value.nationalNumber,
    });
  };

  const handleNumberChange = (event: ChangeEvent<HTMLInputElement>) => {
    const digitsOnly = event.target.value.replace(/\D/g, '');
    onChange({
      country: value.country,
      nationalNumber: digitsOnly,
    });
  };

  const SelectedFlag = FLAG_COMPONENT_BY_COUNTRY[selectedOption.country];

  return (
    <div ref={rootRef} className={`min-w-0 space-y-2 ${className}`}>
      <div className="grid min-w-0 grid-cols-1 items-start gap-3 sm:grid-cols-[10.5rem_minmax(0,1fr)]">
        <div className="relative min-w-0">
          <button
            type="button"
            aria-label={`Phone country: ${selectedOption.label} ${selectedOption.dialCode}`}
            aria-haspopup="listbox"
            aria-expanded={isOpen}
            disabled={disabled}
            onClick={() => setIsOpen((open) => !open)}
            className={`input-field inline-flex w-full items-center justify-between px-3 ${selectClassName}`}
          >
            <span className="flex min-w-0 items-center gap-2 truncate text-sm font-medium text-slate-700">
              <SelectedFlag aria-hidden="true" className="h-4 w-6 shrink-0 rounded-xs shadow-sm" />
              <span className="truncate">{selectedOption.dialCode}</span>
            </span>
            <ChevronDownIcon className="h-4 w-4 shrink-0 text-slate-500" />
          </button>

          {isOpen && !disabled && (
            <ul className="absolute z-20 mt-2 max-h-64 w-full min-w-0 max-w-[calc(100vw-2rem)] overflow-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl sm:w-max sm:min-w-full sm:max-w-[min(24rem,calc(100vw-2rem))]">
              {PHONE_COUNTRY_OPTIONS.map((option) => {
                const OptionFlag = FLAG_COMPONENT_BY_COUNTRY[option.country];

                return (
                <li key={option.country}>
                  <button
                    type="button"
                    onClick={() => {
                      handleCountryChange(option.country);
                      setIsOpen(false);
                    }}
                    className={`flex w-full min-w-0 items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                      option.country === value.country
                        ? 'bg-blue-50 text-blue-700'
                        : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <OptionFlag aria-hidden="true" className="h-4 w-6 shrink-0 rounded-xs shadow-sm" />
                    <span className="min-w-0 flex-1 truncate" title={option.label}>{option.label}</span>
                    <span className="shrink-0 text-right text-xs text-slate-500">
                      <span className="block">{option.dialCode}</span>
                      <span className="block">{option.digitsHint}</span>
                    </span>
                  </button>
                </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="min-w-0">
          <label className="sr-only" htmlFor={name || 'international-phone'}>
            Phone number
          </label>
          <input
            id={name || 'international-phone'}
            name={name}
            type="tel"
            inputMode="numeric"
            autoComplete={autoComplete}
            value={formattedValue}
            onChange={handleNumberChange}
            disabled={disabled}
            placeholder={placeholder}
            className={`input-field w-full ${inputClassName}`}
          />
          <p className="mt-1 text-xs text-slate-500">
            {selectedOption.dialCode} {selectedOption.digitsHint ? `• ${selectedOption.digitsHint}` : ''}
          </p>
        </div>
      </div>
    </div>
  );
}
