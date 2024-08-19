'use client';
import { useState } from 'react';

export default function Home() {
  const [svgFile, setSvgFile] = useState(null);
  const [colors, setColors] = useState('');
  const [responseMessage, setResponseMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false); // State for loading indicator
  const [fileName, setFileName] = useState(''); // State to store the SVG file name

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    setSvgFile(file);
    setFileName(file.name); // Set the file name to display
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!svgFile) {
      setResponseMessage('Please select an SVG file to upload.');
      return;
    }

    setIsLoading(true); // Show loader while data is being submitted

    const colorArray = colors.split(',').map((color) => color.trim());

    const formData = new FormData();
    formData.append('file', svgFile);
    formData.append('colors', JSON.stringify(colorArray));

    try {
      const res = await fetch('/api/svgdata', {
        method: 'POST',
        body: formData,
      });

      const result = await res.json();
      setResponseMessage(result.message);

      // Clear the fields if the data was inserted successfully
      if (res.ok) {
        setSvgFile(null);
        setColors('');
        setFileName(''); // Clear the displayed file name
        e.target.reset(); // Reset the form fields
      }
    } catch (err) {
      setResponseMessage('Error: ' + err.message);
    } finally {
      setIsLoading(false); // Hide loader after submission
    }
  };

  return (
    <div style={styles.container}>
      <h1 style={styles.heading}>Upload SVG Data</h1>
      <form onSubmit={handleSubmit} style={styles.form}>
        <div style={styles.formGroup}>
          <label style={styles.label}>SVG File:</label>
          <input 
            type="file" 
            accept=".svg" 
            onChange={handleFileChange} 
            style={styles.input}
          />
          {fileName && <p style={styles.fileName}>File: {fileName}</p>} {/* Display file name */}
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>Colors (comma-separated):</label>
          <input
            type="text"
            value={colors}
            onChange={(e) => setColors(e.target.value)}
            placeholder="e.g., #000000, #FFFFFF"
            style={styles.input}
          />
        </div>
        <button type="submit" style={styles.button} disabled={isLoading}>
          {isLoading ? 'Uploading...' : 'Submit'}
        </button>
      </form>
      {isLoading ? <div style={styles.loader}>Loading...</div> : <p style={styles.responseMessage}>{responseMessage}</p>} {/* Loader */}
    </div>
  );
}

const styles = {
  container: {
    maxWidth: '600px',
    margin: '0 auto',
    padding: '20px',
    backgroundColor: '#f9f9f9',
    borderRadius: '8px',
    boxShadow: '0 4px 8px rgba(0, 0, 0, 0.1)',
  },
  heading: {
    textAlign: 'center',
    color: '#333',
    marginBottom: '20px',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '15px',
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column',
  },
  label: {
    marginBottom: '5px',
    fontSize: '16px',
    color: '#333',
  },
  input: {
    padding: '10px',
    fontSize: '16px',
    borderRadius: '4px',
    border: '1px solid #ddd',
  },
  fileName: {
    marginTop: '5px',
    fontSize: '14px',
    color: '#555',
  },
  button: {
    padding: '12px',
    fontSize: '16px',
    color: '#fff',
    backgroundColor: '#0070f3',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    transition: 'background-color 0.3s ease',
    textAlign: 'center',
  },
  loader: {
    marginTop: '20px',
    fontSize: '16px',
    textAlign: 'center',
    color: '#0070f3',
  },
  responseMessage: {
    marginTop: '20px',
    fontSize: '16px',
    color: '#0070f3',
    textAlign: 'center',
  },
};
