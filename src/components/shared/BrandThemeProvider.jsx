import { useEffect } from "react";
import { useBrandSettings } from "@/hooks/useBrandSettings";

function hexToHSL(hex) {
  // Remove # if present
  hex = hex.replace(/^#/, '');
  
  // Parse r, g, b
  let r = parseInt(hex.substring(0, 2), 16) / 255;
  let g = parseInt(hex.substring(2, 4), 16) / 255;
  let b = parseInt(hex.substring(4, 6), 16) / 255;

  // Find min and max
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;

  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
      default: h = 0;
    }
  }

  // Convert to degrees and percentages
  h = Math.round(h * 360);
  s = Math.round(s * 100);
  l = Math.round(l * 100);

  return `${h} ${s}% ${l}%`;
}

export default function BrandThemeProvider({ children }) {
  const { data: brand } = useBrandSettings();

  useEffect(() => {
    const root = document.documentElement;
    
    if (brand?.primary_color) {
      const primaryHSL = hexToHSL(brand.primary_color);
      root.style.setProperty('--primary', primaryHSL);
      root.style.setProperty('--ring', primaryHSL);
      root.style.setProperty('--sidebar-primary', primaryHSL);
      
      // Calculate primary-foreground (light or dark based on luminance)
      const l = parseInt(primaryHSL.split(' ')[2]);
      const fg = l > 60 ? '0 0% 10%' : '0 0% 98%';
      root.style.setProperty('--primary-foreground', fg);
      root.style.setProperty('--sidebar-primary-foreground', fg);
    }
    
    if (brand?.secondary_color) {
      const secondaryHSL = hexToHSL(brand.secondary_color);
      root.style.setProperty('--secondary', secondaryHSL);
      root.style.setProperty('--accent', secondaryHSL);
      
      // Calculate secondary/accent foreground
      const l = parseInt(secondaryHSL.split(' ')[2]);
      const fg = l > 60 ? '0 0% 10%' : '0 0% 98%';
      root.style.setProperty('--secondary-foreground', fg);
      root.style.setProperty('--accent-foreground', fg);
    }

    return () => {
      root.style.removeProperty('--primary');
      root.style.removeProperty('--ring');
      root.style.removeProperty('--sidebar-primary');
      root.style.removeProperty('--primary-foreground');
      root.style.removeProperty('--sidebar-primary-foreground');
      root.style.removeProperty('--secondary');
      root.style.removeProperty('--accent');
      root.style.removeProperty('--secondary-foreground');
      root.style.removeProperty('--accent-foreground');
    };
  }, [brand?.primary_color, brand?.secondary_color]);

  return <>{children}</>;
}