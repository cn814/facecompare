export function computeSimilarity(distance, anySunglasses=false){
  const adjust = anySunglasses ? 0.1 : 0;
  let similarity, confidence, isMatch=false;
  if(distance < 0.4 + adjust){ similarity = 95 + ((0.4+adjust)-distance)*12.5; confidence='Very High'; isMatch=true; }
  else if(distance < 0.5 + adjust){ similarity = 85 + ((0.5+adjust)-distance)*100; confidence='High'; isMatch=true; }
  else if(distance < 0.6 + adjust){ similarity = 70 + ((0.6+adjust)-distance)*150; confidence='Good'; isMatch=true; }
  else if(distance < 0.7 + adjust){ similarity = 50 + ((0.7+adjust)-distance)*200; confidence='Low'; isMatch=false; }
  else { similarity = Math.max(0, 50 - (distance - (0.7+adjust))*100); confidence='Low'; isMatch=false; }
  similarity = Math.min(100, Math.max(0, similarity));
  return {similarity, confidence, isMatch};
}
