import librosa
import sys
import json

try:
    audio_path = sys.argv[1]
    
    y, sr = librosa.load(audio_path)
    
    tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
    bpm = int(round(tempo))
    
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
    key_idx = chroma.mean(axis=1).argmax()
    keys = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']
    
    chroma_profile = chroma.mean(axis=1)
    is_minor = chroma_profile[(key_idx + 3) % 12] > chroma_profile[(key_idx + 4) % 12]
    mode = 'm' if is_minor else ''
    
    result = {
        'bpm': bpm,
        'key': keys[key_idx] + mode
    }
    
    print(json.dumps(result))
    
except Exception as e:
    print(json.dumps({'bpm': None, 'key': None, 'error': str(e)}), file=sys.stderr)
    sys.exit(1)