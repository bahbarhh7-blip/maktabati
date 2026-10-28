import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import type { Book } from "@/lib/models";
import { rankBookMatches } from "@/lib/bookSearch";
import { translate, type AppLanguage } from "@/lib/i18n";

type Props = {
  value: string;
  books: Book[];
  language: AppLanguage;
  placeholder: string;
  onChange: (value: string) => void;
  onSelect: (book: Book) => void;
};

export default function BookSearchBox({ value, books, language, placeholder, onChange, onSelect }: Props) {
  const [focused, setFocused] = useState(false);
  const matches = useMemo(() => rankBookMatches(books, value).slice(0, 6), [books, value]);
  const showSuggestions = focused && Boolean(value.trim()) && matches.length > 0;

  const choose = (book: Book) => {
    onChange(book.title);
    setFocused(false);
    onSelect(book);
  };

  return <div className="book-search-box">
    <label className="search-field">
      <Search size={17} />
      <input
        value={value}
        onChange={event => onChange(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => window.setTimeout(() => setFocused(false), 120)}
        onKeyDown={event => {
          if (event.key === "Escape") setFocused(false);
          if (event.key === "Enter" && matches[0]) { event.preventDefault(); choose(matches[0].book); }
        }}
        placeholder={placeholder}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showSuggestions}
        aria-controls="book-search-suggestions"
        autoComplete="off"
      />
      <button type="button" className="clear-search" onMouseDown={event => event.preventDefault()} onClick={() => onChange("")} hidden={!value} aria-label={translate("مسح البحث", language)}><X size={14} /></button>
    </label>
    {showSuggestions && <div className="book-search-suggestions" id="book-search-suggestions" role="listbox" aria-label={translate("مقترحات البحث", language)}>
      {matches.map(({ book, field }) => <button
        type="button"
        role="option"
        aria-selected="false"
        key={book.id}
        onMouseDown={event => event.preventDefault()}
        onClick={() => choose(book)}
      >
        <span className="suggestion-main"><b>{book.title}</b><small>{book.author || translate("المؤلف غير محدد", language)}</small></span>
        <span className="suggestion-field">{translate(field, language)}</span>
      </button>)}
    </div>}
  </div>;
}
