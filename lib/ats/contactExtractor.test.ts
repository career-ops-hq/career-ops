import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractContactInfo } from './contactExtractor.ts';

describe('Contact Information Extraction Engine', () => {
  it('Test 1: Complete contact block parsing', () => {
    const text = `
John Doe
Software Engineer
john@example.com
+1 555 123 4567
New York, NY
linkedin.com/in/johndoe
github.com/johndoe
johndoe.dev
    `.trim();

    const lines = text.split('\n');
    const result = extractContactInfo(lines, text);

    assert.equal(result.name, 'John Doe');
    assert.equal(result.email, 'john@example.com');
    assert.equal(result.phone, '+1 555 123 4567');
    assert.equal(result.location, 'New York, NY');
    assert.equal(result.linkedIn, 'linkedin.com/in/johndoe');
    assert.equal(result.github, 'github.com/johndoe');
    assert.equal(result.website, 'johndoe.dev');
  });

  it('Test 2: False positive prevention ("GitHub, VS" not location, "email.com" not portfolio)', () => {
    const text = `
Sujoy Moulick
Software Engineer

sujoymoulick05@email.com
8942841651
GitHub, VS
linkedin.com/in/sujoumoulick
    `.trim();

    const lines = text.split('\n');
    const result = extractContactInfo(lines, text);

    assert.equal(result.name, 'Sujoy Moulick');
    assert.equal(result.email, 'sujoymoulick05@email.com');
    assert.equal(result.phone, '8942841651');
    assert.equal(result.location, null, 'GitHub, VS must not be classified as a location');
    assert.equal(result.linkedIn, 'linkedin.com/in/sujoumoulick');
    assert.equal(result.github, null, 'GitHub text without URL must not be classified as GitHub profile');
    assert.equal(result.website, null, 'email.com must not be extracted as portfolio website');
  });

  it('Test 3: Location with city and country', () => {
    const text = `
Jane Smith
Kolkata, India
jane.smith@gmail.com
+91 9876543210
    `.trim();

    const lines = text.split('\n');
    const result = extractContactInfo(lines, text);

    assert.equal(result.name, 'Jane Smith');
    assert.equal(result.location, 'Kolkata, India');
    assert.equal(result.email, 'jane.smith@gmail.com');
    assert.equal(result.phone, '+91 9876543210');
  });

  it('Test 4: Explicit portfolio site vs email domain', () => {
    const text = `
Alex Morgan
Frontend Developer
alex@portfolio.dev
portfolio.dev
linkedin.com/in/alexmorgan
    `.trim();

    const lines = text.split('\n');
    const result = extractContactInfo(lines, text);

    assert.equal(result.name, 'Alex Morgan');
    assert.equal(result.email, 'alex@portfolio.dev');
    assert.equal(result.website, 'portfolio.dev');
    assert.equal(result.linkedIn, 'linkedin.com/in/alexmorgan');
  });

  it('Test 4b: Email domain is NOT extracted as website when no explicit URL exists', () => {
    const text = `
Alex Morgan
Frontend Developer
alex@portfolio.dev
linkedin.com/in/alexmorgan
    `.trim();

    const lines = text.split('\n');
    const result = extractContactInfo(lines, text);

    assert.equal(result.name, 'Alex Morgan');
    assert.equal(result.email, 'alex@portfolio.dev');
    assert.equal(result.website, null, 'Email domain portfolio.dev should not be extracted as website');
  });
});
