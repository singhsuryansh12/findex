type BrandLogoProps = {
  compact?: boolean;
  small?: boolean;
  className?: string;
};

export function BrandLogo({ compact = false, small = false, className = "" }: BrandLogoProps) {
  return (
    <span className={`brand-logo ${small ? "brand-logo-small" : ""} ${className}`.trim()} role="img" aria-label="FinDex">
      <svg className="brand-symbol" viewBox="0 0 40 40" role="img" aria-hidden="true">
        <rect width="40" height="40" rx="12" fill="currentColor" />
        <path d="M12.5 29V11.5H27.5" className="brand-monogram" />
        <path d="M12.5 19.2H24" className="brand-monogram" />
        <path d="M26.8 8.2L27.7 11.1L30.6 12L27.7 12.9L26.8 15.8L25.9 12.9L23 12L25.9 11.1L26.8 8.2Z" className="brand-spark" />
        <circle cx="29.2" cy="27.5" r="1.6" className="brand-accent" />
      </svg>
      {!compact && (
        <span className="brand-wordmark" aria-hidden="true">
          <span className="brand-wordmark-fin">Fin</span><span className="brand-wordmark-dex">Dex</span>
        </span>
      )}
    </span>
  );
}
