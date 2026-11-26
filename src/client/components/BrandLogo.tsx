interface BrandLogoProps {
  size?: 'sm' | 'md' | 'lg';
}

export function BrandLogo({ size = 'md' }: BrandLogoProps) {
  const boxClass =
    size === 'lg'
      ? 'w-14 h-14 rounded-2xl'
      : size === 'sm'
        ? 'w-7 h-7 rounded-xl'
        : 'w-9 h-9 rounded-2xl';
  const iconSize = size === 'lg' ? 26 : size === 'sm' ? 14 : 18;

  return (
    <div className={`${boxClass} btn-crystal flex items-center justify-center shrink-0`}>
      <svg
        width={iconSize}
        height={iconSize}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M21 4L3 11.2l6.8 2.6L19 6.5l-6.6 9.1V20l3.4-3.1 4.2 1.8L21 4Z" />
      </svg>
    </div>
  );
}
