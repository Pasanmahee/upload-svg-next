'use client';
import { useState, useEffect } from 'react';

export default function Home() {
  const [svgFile, setSvgFile] = useState(null);
  const [colors, setColors] = useState('');
  const [responseMessage, setResponseMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [fileName, setFileName] = useState('');
  const [categories, setCategories] = useState([]); // State for all categories
  const [selectedCategories, setSelectedCategories] = useState([]); // State for selected categories
  const [newCategory, setNewCategory] = useState(''); // State for new category input

  // Fetch existing categories from the database when component mounts
  const fetchCategories = async () => {
    try {
      const res = await fetch('/api/categories');
      const data = await res.json();
      setCategories(data.categories);
    } catch (err) {
      setResponseMessage('Error fetching categories: ' + err.message);
    }
  };

  useEffect(() => {
    fetchCategories();
  }, []);

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    setSvgFile(file);
    setFileName(file.name);
  };

  const handleCategoryChange = (e) => {
    const value = Array.from(
      e.target.selectedOptions,
      (option) => option.value
    );
    setSelectedCategories(value);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!svgFile) {
      setResponseMessage('Please select an SVG file to upload.');
      return;
    }

    setIsLoading(true);

    const colorArray = colors.split(',').map((color) => color.trim());

    const formData = new FormData();
    formData.append('file', svgFile);
    formData.append('colors', JSON.stringify(colorArray));
    formData.append('categories', JSON.stringify(selectedCategories));
    formData.append('newCategory', newCategory.trim()); // Include new category in the form data

    try {
      const res = await fetch('/api/svgdata', {
        method: 'POST',
        body: formData,
      });

      const result = await res.json();
      setResponseMessage(result.message);

      if (res.ok) {
        setSvgFile(null);
        setColors('');
        setFileName('');
        setSelectedCategories([]);
        setNewCategory(''); // Clear the new category input
        fetchCategories();
        e.target.reset();
      }
    } catch (err) {
      setResponseMessage('Error: ' + err.message);
    } finally {
      setIsLoading(false);
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
          {fileName && <p style={styles.fileName}>File: {fileName}</p>}
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
        <div style={styles.formGroup}>
          <label style={styles.label}>Categories:</label>
          <select
            multiple
            value={selectedCategories}
            onChange={handleCategoryChange}
            style={{ ...styles.input, height: '400px', width: '100%' }} // Adjust height and width as needed
            size={5} // Number of visible options, adjust as needed
          >
            {categories?.map((category) => (
              <option key={category._id} value={category._id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>Add New Category:</label>
          <input
            type="text"
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            placeholder="New Category"
            style={styles.input}
          />
        </div>
        <button type="submit" style={styles.button} disabled={isLoading}>
          {isLoading ? 'Uploading...' : 'Submit'}
        </button>
      </form>
      {isLoading ? <div style={styles.loader}>Loading...</div> : <p style={styles.responseMessage}>{responseMessage}</p>}
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
