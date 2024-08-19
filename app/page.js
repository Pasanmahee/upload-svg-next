'use client';
import { useState } from 'react';

export default function Home() {
  const [svgFile, setSvgFile] = useState(null);
  const [colors, setColors] = useState('');
  const [responseMessage, setResponseMessage] = useState('');

  const handleFileChange = (e) => {
    setSvgFile(e.target.files[0]);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!svgFile) {
      setResponseMessage('Please select an SVG file to upload.');
      return;
    }

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
    } catch (err) {
      setResponseMessage('Error: ' + err.message);
    }
  };

  return (
    <div>
      <h1>Upload SVG Data</h1>
      <form onSubmit={handleSubmit}>
        <div>
          <label>SVG File:</label>
          <input type="file" accept=".svg" onChange={handleFileChange} />
        </div>
        <div>
          <label>Colors (comma-separated):</label>
          <input
            type="text"
            value={colors}
            onChange={(e) => setColors(e.target.value)}
          />
        </div>
        <button type="submit">Submit</button>
      </form>
      {responseMessage && <p>{responseMessage}</p>}
    </div>
  );
}
