// Example texts (short song excerpts; melodies transcribed by ear)
const PRESETS = [
  {
    name: 'Ciao (IT)', lang: 'it', voice: 'male',
    text: 'Ciao! Sono un sintetizzatore vocale a formanti, costruito con le regole di Klatt e con la sintesi MBROLA. Ti piace la mia voce? Un po\' monotona, che dici?'
  },
  {
    name: 'Hello (EN)', lang: 'en', voice: 'female',
    text: 'Hello world. I am a formant speech synthesizer, running en taierly in your browser. Can you understand me?'
  },
  {
    name: 'Singing in the Rain', lang: 'en', voice: 'male',
    text: '\\tempo:120\n' +
      '\\note:G3 \\time:8 I\'m \\note:G4,E4 \\time:2,8 singing \\note:D4 \\time:8 in \\note:C4 the \\note:G3 \\time:2 rain, \\rest:4\n' +
      '\\note:G3 \\time:8 just \\note:C4,C4 \\time:2,8 singing \\note:D4 \\time:8 in \\note:E4 the \\note:G4 \\time:2 rain. \\rest:4\n' +
      '\\note:G3 \\time:8 what \\note:A3 a \\note:C4,D4,E4 \\time:4,8,8 glorious \\note:G4,E4 \\time:4,4 feeling, \\rest:4\n' +
      '\\note:G4 \\time:8 I\'m \\note:G4,F4 \\time:4,8 happy \\note:E4,A3 \\time:8,1 again.'
  },
  {
    name: 'Happy Birthday', lang: 'en', voice: 'female',
    text: '\\tempo:116\n' +
      '\\note:G4,G4 \\time:8.,16 happy \\note:A4,G4 \\time:4 birthday \\note:C5 to \\note:B4 \\time:2 you \\rest:4\n' +
      '\\note:G4,G4 \\time:8.,16 happy \\note:A4,G4 \\time:4 birthday \\note:D5 to \\note:C5 \\time:2 you \\rest:4\n' +
      '\\note:G4,G4 \\time:8.,16 happy \\note:G5,E5 \\time:4 birthday \\note:C5 dear \\note:B4,A4 \\time:4,2 friend \\rest:4\n' +
      '\\note:F5,F5 \\time:8.,16 happy \\note:E5,C5 \\time:4 birthday \\note:D5 to \\note:C5 \\time:2 you.'
  },
  {
    name: 'Daft Punk', lang: 'en', voice: 'robot',
    text: '\\tempo:175\n' +
      '\\note:F#2 \\time:8. work \\note:F#2 \\time:8. it \\rest:3\n' +
      '\\note:F#3 \\time:8. make \\note:F#3 \\time:8. it \\rest:3\n' +
      '\\note:A2 \\time:8. do \\note:A2 \\time:8. it \\rest:3\n' +
      '\\note:A3 \\time:8. makes \\note:A3 \\time:8. us \\rest:1+2\n\n' +
      '\\note:C#4,B3 \\time:8.,8. harder \\rest:3\n' +
      '\\note:A3,F#3 \\time:8.,8. better \\rest:3\n' +
      '\\note:E3,C#3 \\time:8.,8. faster \\rest:3\n' +
      '\\note:B2,A2 \\time:8.,8 stronger'
  }
];
