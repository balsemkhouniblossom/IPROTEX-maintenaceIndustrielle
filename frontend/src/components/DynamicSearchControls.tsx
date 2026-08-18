import { useEffect } from 'react';
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { ALL_FIELDS_TOKEN } from '@/services/dynamicSearch';

const SEARCH_HIGHLIGHT_ATTR = 'data-search-highlight';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildSearchExpression(searchTerm: string): RegExp | null {
  const tokens = searchTerm
    .trim()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length === 0) {
    return null;
  }

  const pattern = Array.from(new Set(tokens))
    .sort((left, right) => right.length - left.length)
    .map((token) => escapeRegExp(token))
    .join('|');

  if (!pattern) {
    return null;
  }

  return new RegExp(pattern, 'gi');
}

function clearSearchHighlights(): void {
  const highlights = document.querySelectorAll(`mark[${SEARCH_HIGHLIGHT_ATTR}]`);

  highlights.forEach((highlight) => {
    const parent = highlight.parentNode;
    if (!parent) return;

    highlight.replaceWith(document.createTextNode(highlight.textContent || ''));
    parent.normalize();
  });
}

function applyHighlightToTextNode(textNode: Text, expression: RegExp): void {
  const text = textNode.textContent || '';
  expression.lastIndex = 0;

  if (!expression.test(text)) {
    return;
  }

  expression.lastIndex = 0;

  const fragment = document.createDocumentFragment();
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = expression.exec(text)) !== null) {
    const startIndex = match.index;
    const matchedText = match[0];
    const endIndex = startIndex + matchedText.length;

    if (startIndex > lastIndex) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex, startIndex)));
    }

    const mark = document.createElement('mark');
    mark.setAttribute(SEARCH_HIGHLIGHT_ATTR, 'true');
    mark.className = 'search-highlight';
    mark.textContent = matchedText;
    fragment.appendChild(mark);

    lastIndex = endIndex;

    if (expression.lastIndex === startIndex) {
      expression.lastIndex += 1;
    }
  }

  if (lastIndex < text.length) {
    fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
  }

  const parent = textNode.parentNode;
  if (!parent) {
    return;
  }

  textNode.replaceWith(fragment);
}

function highlightTableText(searchTerm: string): void {
  const expression = buildSearchExpression(searchTerm);
  if (!expression) {
    return;
  }
  const tableCells = document.querySelectorAll('table tbody td');

  tableCells.forEach((cell) => {
    const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!(node instanceof Text)) {
          return NodeFilter.FILTER_REJECT;
        }

        const parent = node.parentElement;
        if (!parent) {
          return NodeFilter.FILTER_REJECT;
        }

        if (parent.tagName === 'MARK' && parent.hasAttribute(SEARCH_HIGHLIGHT_ATTR)) {
          return NodeFilter.FILTER_REJECT;
        }

        return node.textContent?.trim()
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    });

    const nodes: Text[] = [];
    let currentNode = walker.nextNode();

    while (currentNode) {
      if (currentNode instanceof Text) {
        nodes.push(currentNode);
      }
      currentNode = walker.nextNode();
    }

    nodes.forEach((textNode) => applyHighlightToTextNode(textNode, expression));
  });
}

interface DynamicSearchControlsProps {
  selectedField: string;
  onSelectedFieldChange: (value: string) => void;
  searchableFields: string[];
  allFieldsLabel: string;
  searchTerm: string;
  onSearchTermChange: (value: string) => void;
  searchPlaceholder: string;
  className?: string;
  selectClassName?: string;
  inputClassName?: string;
}

function toDisplayLabel(field: string): string {
  return field
    .split('.')
    .map((segment) =>
      segment
        .replace(/[_-]+/g, ' ')
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/\b\w/g, (char) => char.toUpperCase()),
    )
    .join(' > ');
}

export default function DynamicSearchControls({
  selectedField,
  onSelectedFieldChange,
  searchableFields,
  allFieldsLabel,
  searchTerm,
  onSearchTermChange,
  searchPlaceholder,
  className = 'mt-4',
  selectClassName = 'input-field',
  inputClassName = 'input-field pl-10 w-full',
}: DynamicSearchControlsProps) {
  useEffect(() => {
    clearSearchHighlights();
    highlightTableText(searchTerm);

    return () => {
      clearSearchHighlights();
    };
  }, [searchTerm, selectedField]);

  return (
    <div className={`${className} grid min-w-0 gap-3 md:grid-cols-[minmax(0,240px)_minmax(0,1fr)]`}>
      <select
        value={selectedField}
        onChange={(e) => onSelectedFieldChange(e.target.value)}
        aria-label={allFieldsLabel}
        title={allFieldsLabel}
        className={selectClassName}
      >
        <option value={ALL_FIELDS_TOKEN}>{allFieldsLabel}</option>
        {searchableFields.map((field) => (
          <option key={field} value={field}>
            {toDisplayLabel(field)}
          </option>
        ))}
      </select>

      <div className="relative min-w-0">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          <MagnifyingGlassIcon className="h-5 w-5 text-gray-400" />
        </div>
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => onSearchTermChange(e.target.value)}
          placeholder={searchPlaceholder}
          title={searchPlaceholder}
          className={inputClassName}
        />
      </div>
    </div>
  );
}
