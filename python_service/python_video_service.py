
"""
Alternative Python microservice for video generation
Can be used instead of the Node.js FFmpeg integration
"""

import os
import sys
import subprocess
import json
from flask import Flask, request, jsonify
import tempfile
import uuid
from pathlib import Path

app = Flask(__name__)

class VideoGenerator:
    def __init__(self):
        # Ensure FFmpeg is available
        try:
            subprocess.run(['ffmpeg', '-version'], 
                         capture_output=True, check=True)
        except (subprocess.CalledProcessError, FileNotFoundError):
            raise RuntimeError("FFmpeg not found. Please install FFmpeg.")
    
    def generate_video(self, audio_path, image_path, output_path):
        """Generate video using FFmpeg with optimized settings for beat videos"""
        
        cmd = [
            'ffmpeg',
            '-y',  # Overwrite output file
            '-loop', '1',  # Loop the input image
            '-i', image_path,  # Input image
            '-i', audio_path,  # Input audio
            '-c:v', 'libx264',  # Video codec
            '-tune', 'stillimage',  # Optimize for still image
            '-c:a', 'aac',  # Audio codec
            '-b:a', '192k',  # Audio bitrate
            '-pix_fmt', 'yuv420p',  # Pixel format for compatibility
            '-shortest',  # Stop when shortest input ends
            '-r', '1',  # 1 fps for still image (saves space)
            '-s', '1920x1080',  # Full HD resolution
            output_path
        ]
        
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, check=True)
            return True, "Video generated successfully"
        except subprocess.CalledProcessError as e:
            return False, f"FFmpeg error: {e.stderr}"

@app.route('/generate-video', methods=['POST'])
def generate_video_endpoint():
    try:
        # Get file uploads
        audio_file = request.files.get('audio')
        image_file = request.files.get('image')
        
        if not audio_file or not image_file:
            return jsonify({
                'success': False, 
                'error': 'Both audio and image files required'
            }), 400
        
        # Create temporary files
        session_id = str(uuid.uuid4())
        temp_dir = tempfile.mkdtemp()
        
        audio_path = os.path.join(temp_dir, f'audio_{session_id}.mp3')
        image_path = os.path.join(temp_dir, f'image_{session_id}.jpg')
        output_path = os.path.join(temp_dir, f'video_{session_id}.mp4')
        
        # Save uploaded files
        audio_file.save(audio_path)
        image_file.save(image_path)
        
        # Generate video
        generator = VideoGenerator()
        success, message = generator.generate_video(audio_path, image_path, output_path)
        
        if success:
            # Return the video file
            return jsonify({
                'success': True,
                'video_path': output_path,
                'session_id': session_id,
                'message': message
            })
        else:
            return jsonify({
                'success': False,
                'error': message
            }), 500
            
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({'status': 'healthy', 'service': 'video-generator'})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
