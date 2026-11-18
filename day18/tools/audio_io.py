# Reading and writing the sound effects with ffmpeg (decode any format to float samples, encode MP3).
# ffmpeg is looked for in the FFMPEG environment variable (path of ffmpeg.exe), then in
# D:\software\ffmpeg\bin, then in the PATH. ffprobe must sit next to it.
import os
import shutil
import subprocess
import numpy as np

_DEFAULT = r'D:\software\ffmpeg\bin\ffmpeg.exe'


def _tool(name):
    ff = os.environ.get('FFMPEG') or (_DEFAULT if os.path.exists(_DEFAULT) else shutil.which('ffmpeg'))
    if not ff:
        raise SystemExit('ffmpeg not found: set the FFMPEG environment variable to the path of ffmpeg.exe')
    return ff if name == 'ffmpeg' else os.path.join(os.path.dirname(ff), name + os.path.splitext(ff)[1])


def read(path):
    """-> (sample rate, float32 array of shape [samples, channels] in -1..1)"""
    probe = subprocess.run([_tool('ffprobe'), '-v', 'error', '-select_streams', 'a:0', '-show_entries',
                            'stream=sample_rate,channels', '-of', 'csv=p=0', path], capture_output=True, text=True, check=True)
    sr, ch = (int(v) for v in probe.stdout.strip().split(','))
    raw = subprocess.run([_tool('ffmpeg'), '-v', 'error', '-i', path, '-f', 'f32le', '-acodec', 'pcm_f32le', '-'],
                         capture_output=True, check=True).stdout
    return sr, np.frombuffer(raw, dtype=np.float32).reshape(-1, ch).copy()


def write_mp3(path, data, sr, kbps=192):
    """data: float array [samples, channels] (or [samples] for mono); MP3 with the LAME header,
    so the decoder trims the encoder delay and loops stay seamless."""
    data = np.asarray(data, np.float32)
    if data.ndim == 1:
        data = data[:, None]
    subprocess.run([_tool('ffmpeg'), '-v', 'error', '-y', '-f', 'f32le', '-ar', str(sr), '-ac', str(data.shape[1]), '-i', '-',
                    '-codec:a', 'libmp3lame', '-b:a', f'{kbps}k', path], input=np.clip(data, -1, 1).tobytes(), check=True)
