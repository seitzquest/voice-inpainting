#!/usr/bin/env python3
"""
Simple test script to debug API issues
"""

import sys
import traceback
sys.path.append('.')

def test_imports():
    """Test if all imports work correctly"""
    print("Testing imports...")
    
    try:
        from src.session_manager import get_session_manager
        print("✓ SessionManager import successful")
    except Exception as e:
        print(f"✗ SessionManager import failed: {e}")
        traceback.print_exc()
        return False
    
    try:
        from src.api_mvc import router
        print("✓ MVC API router import successful")
    except Exception as e:
        print(f"✗ MVC API router import failed: {e}")
        traceback.print_exc()
        return False
    
    try:
        from src.aligned_sequences import AlignedTokenSequence
        print("✓ AlignedTokenSequence import successful")
    except Exception as e:
        print(f"✗ AlignedTokenSequence import failed: {e}")
        traceback.print_exc()
        return False
    
    try:
        from src.token_store import TokenStore
        print("✓ TokenStore import successful")
    except Exception as e:
        print(f"✗ TokenStore import failed: {e}")
        traceback.print_exc()
        return False
    
    return True

def test_basic_session_creation():
    """Test basic session manager functionality"""
    print("\nTesting basic session creation...")
    
    try:
        from src.session_manager import get_session_manager
        session_manager = get_session_manager()
        print("✓ Session manager created successfully")
        
        # Create a minimal valid WAV file
        import wave
        import tempfile
        import os
        
        # Create a temporary WAV file
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_wav:
            with wave.open(tmp_wav.name, 'wb') as wav_file:
                wav_file.setnchannels(1)  # Mono
                wav_file.setsampwidth(2)  # 16-bit
                wav_file.setframerate(16000)  # 16kHz
                # 1 second of silence
                silence = b'\x00\x00' * 16000
                wav_file.writeframes(silence)
            
            # Read the WAV file as bytes
            with open(tmp_wav.name, 'rb') as f:
                fake_audio_data = f.read()
            
            # Clean up
            os.unlink(tmp_wav.name)
        
        try:
            session_id = session_manager.create_session(fake_audio_data, "test.wav", device="cpu")
            print(f"✓ Test session created: {session_id}")
            return True
        except Exception as e:
            print(f"✗ Session creation failed: {e}")
            traceback.print_exc()
            return False
            
    except Exception as e:
        print(f"✗ Session manager setup failed: {e}")
        traceback.print_exc()
        return False

def test_api_health():
    """Test the health endpoint"""
    print("\nTesting API health endpoint...")
    
    try:
        import requests
        response = requests.get("http://localhost:8000/api/v2/health")
        if response.status_code == 200:
            print("✓ Health endpoint working")
            print(f"Response: {response.json()}")
            return True
        else:
            print(f"✗ Health endpoint failed: {response.status_code}")
            return False
    except Exception as e:
        print(f"✗ Could not test health endpoint (server may not be running): {e}")
        return False

if __name__ == "__main__":
    print("Voice Inpainting API Test")
    print("=" * 40)
    
    # Test imports
    if not test_imports():
        print("\n❌ Import tests failed")
        sys.exit(1)
    
    # Test basic functionality
    if not test_basic_session_creation():
        print("\n❌ Session creation tests failed")
        sys.exit(1)
    
    # Test API health (optional - server might not be running)
    test_api_health()
    
    print("\n✅ All tests passed!")
    print("\nYou can now try:")
    print("1. uv run main.py")
    print("2. Open http://localhost:8000 in your browser")
    print("3. Upload an audio file using the 'Upload' option")