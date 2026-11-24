package mobilecore

import (
	"bytes"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"math"

	_ "golang.org/x/image/webp"
)

type rgbColor struct {
	R uint8 `json:"r"`
	G uint8 `json:"g"`
	B uint8 `json:"b"`
}

// coverPalette holds the extracted cover colors matching desktop MyGo Music:
//   - Tint: dominant HSV-weighted color (or fallback rgb(120, 120, 130))
//   - Accent: Tint mixed 45% toward white (used for stage lyrics & smoke)
//   - Deep / Fog: fogColors(Tint) for the WebGL fog backdrop shader
type coverPalette struct {
	Tint   rgbColor `json:"tint"`
	Accent rgbColor `json:"accent"`
	Deep   rgbColor `json:"deep"`
	Fog    rgbColor `json:"fog"`
}

func defaultCoverPalette() coverPalette {
	return paletteFromTint(rgbColor{120, 120, 130})
}

func paletteFromTint(tint rgbColor) coverPalette {
	deep, fog := fogColors(tint)
	accent := mixRGB(tint, rgbColor{255, 255, 255}, 0.45)
	return coverPalette{
		Tint:   tint,
		Accent: accent,
		Deep:   deep,
		Fog:    fog,
	}
}

func extractPalette(raw []byte) coverPalette {
	img, _, err := image.Decode(bytes.NewReader(raw))
	if err != nil {
		return defaultCoverPalette()
	}
	tint := dominantColor(img)
	return paletteFromTint(tint)
}

// dominantColor matches internal/app/artwork.go: shrink to 24x24, 18 hue
// buckets weighted by s*s*v, falling back to mean RGB for low-saturation art.
func dominantColor(img image.Image) rgbColor {
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	if w <= 0 || h <= 0 {
		return rgbColor{120, 120, 130}
	}
	const sample = 24
	const buckets = 18
	type bucket struct {
		w, r, g, b float64
	}
	var bs [buckets]bucket
	var allR, allG, allB, count float64

	for sy := 0; sy < sample; sy++ {
		y0 := b.Min.Y + sy*h/sample
		y1 := b.Min.Y + (sy+1)*h/sample
		if y1 <= y0 {
			y1 = y0 + 1
		}
		for sx := 0; sx < sample; sx++ {
			x0 := b.Min.X + sx*w/sample
			x1 := b.Min.X + (sx+1)*w/sample
			if x1 <= x0 {
				x1 = x0 + 1
			}
			var sr, sg, sb, n float64
			// Sample center & corners inside cell (or every pixel for small images)
			stepY := max(1, (y1-y0)/3)
			stepX := max(1, (x1-x0)/3)
			for y := y0; y < y1; y += stepY {
				for x := x0; x < x1; x += stepX {
					r16, g16, b16, _ := img.At(x, y).RGBA()
					sr += float64(r16>>8) / 255.0
					sg += float64(g16>>8) / 255.0
					sb += float64(b16>>8) / 255.0
					n++
				}
			}
			if n == 0 {
				continue
			}
			rf, gf, bf := sr/n, sg/n, sb/n
			allR += rf
			allG += gf
			allB += bf
			count++

			hu, s, v := rgbToHSV(rf, gf, bf)
			if s < 0.15 || v < 0.15 {
				continue
			}
			idx := int(hu*buckets) % buckets
			if idx < 0 {
				idx += buckets
			}
			wt := s * s * v
			bs[idx].w += wt
			bs[idx].r += rf * wt
			bs[idx].g += gf * wt
			bs[idx].b += bf * wt
		}
	}

	best := 0
	for i := 1; i < buckets; i++ {
		if bs[i].w > bs[best].w {
			best = i
		}
	}
	if bs[best].w >= 2 {
		return rgbColor{
			R: toByte(bs[best].r / bs[best].w),
			G: toByte(bs[best].g / bs[best].w),
			B: toByte(bs[best].b / bs[best].w),
		}
	}
	if count > 0 {
		return rgbColor{
			R: toByte(allR / count),
			G: toByte(allG / count),
			B: toByte(allB / count),
		}
	}
	return rgbColor{120, 120, 130}
}

// fogColors matches internal/app/backdrop.go.
func fogColors(tint rgbColor) (deep, fog rgbColor) {
	h, s, _ := rgbToHSV(float64(tint.R)/255, float64(tint.G)/255, float64(tint.B)/255)
	if s > 0.12 {
		s = math.Min(math.Max(s*1.3, 0.6), 0.85)
	}
	return hsvToRGB(h, s, 0.30), hsvToRGB(h, s*0.6, 0.72)
}

func mixRGB(a, b rgbColor, t float64) rgbColor {
	return rgbColor{
		R: toByte((float64(a.R)*(1-t) + float64(b.R)*t) / 255.0),
		G: toByte((float64(a.G)*(1-t) + float64(b.G)*t) / 255.0),
		B: toByte((float64(a.B)*(1-t) + float64(b.B)*t) / 255.0),
	}
}

func rgbToHSV(r, g, b float64) (h, s, v float64) {
	mx := math.Max(r, math.Max(g, b))
	mn := math.Min(r, math.Min(g, b))
	v = mx
	d := mx - mn
	if mx > 0 {
		s = d / mx
	}
	if d == 0 {
		return 0, s, v
	}
	switch mx {
	case r:
		h = (g - b) / d
		if g < b {
			h += 6
		}
	case g:
		h = (b-r)/d + 2
	default:
		h = (r-g)/d + 4
	}
	h /= 6
	return h, s, v
}

func hsvToRGB(h, s, v float64) rgbColor {
	if s <= 0 {
		b := toByte(v)
		return rgbColor{b, b, b}
	}
	h = math.Mod(h, 1)
	if h < 0 {
		h++
	}
	i := math.Floor(h * 6)
	f := h*6 - i
	p := v * (1 - s)
	q := v * (1 - f*s)
	t := v * (1 - (1-f)*s)
	var r, g, b float64
	switch int(i) % 6 {
	case 0:
		r, g, b = v, t, p
	case 1:
		r, g, b = q, v, p
	case 2:
		r, g, b = p, v, t
	case 3:
		r, g, b = p, q, v
	case 4:
		r, g, b = t, p, v
	default:
		r, g, b = v, p, q
	}
	return rgbColor{toByte(r), toByte(g), toByte(b)}
}

func toByte(f float64) uint8 {
	if f <= 0 {
		return 0
	}
	if f >= 1 {
		return 255
	}
	return uint8(math.Round(f * 255))
}
