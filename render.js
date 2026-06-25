const path = require('path')
const fs = require('fs')
module.exports = function (logger) {


    const templatePathIndex = path.join(__dirname, 'public', 'index.html')
    let htmlTemplateIndex = fs.readFileSync(templatePathIndex, 'utf8')
    const templatePathBook = path.join(__dirname, 'public', 'book.html')
    let htmlTemplateBook = fs.readFileSync(templatePathBook, 'utf8')
    const templatePathFaq = path.join(__dirname, 'public', 'faq.html')
    let htmlTemplateFaq = fs.readFileSync(templatePathFaq, 'utf8')
    const templatePathAmenities = path.join(__dirname, 'public', 'amenities.html')
    let htmlTemplateAmenities = fs.readFileSync(templatePathAmenities, 'utf8')
    const templatePathNotice = path.join(__dirname, 'public', 'notice.html')
    let htmlTemplateNotice = fs.readFileSync(templatePathNotice, 'utf8')
    const templatePathBlog = path.join(__dirname, 'public', 'blog-post.html')
    let htmlTemplateBlog = fs.readFileSync(templatePathBlog, 'utf8')

    const languages = {
        en: JSON.parse(fs.readFileSync(path.join(__dirname, 'locales', 'en.json'), 'utf8')),
        de: JSON.parse(fs.readFileSync(path.join(__dirname, 'locales', 'de.json'), 'utf8')),
        it: JSON.parse(fs.readFileSync(path.join(__dirname, 'locales', 'it.json'), 'utf8')),
        sr: JSON.parse(fs.readFileSync(path.join(__dirname, 'locales', 'sr.json'), 'utf8')),
    }

    function loadLatestBlogs(lang) {

        try {

            const blogsDir = path.join(__dirname, 'public/blogs')
            const files = fs.readdirSync(blogsDir)
            const blogs = files.sort().reverse().slice(0, 2).map(filename => {
                const filePath = path.join(blogsDir, filename)
                const blogData = JSON.parse(fs.readFileSync(filePath, 'utf8'))

                const metaKey = `${lang}_meta`;
                let title = blogData.title;
                if (lang !== 'en' && blogData[metaKey] && blogData[metaKey].title) {
                    title = blogData[metaKey].title;
                }

                const data = { title: title, title_img: blogData.title_img, blogid: blogData.blogid }
                return data
            })


            return blogs

        } catch (error) {
            logger.info(error.message)
            return null
        }
    }


    function renderIndex(res, lang) {

        const t = languages[lang] || languages['en']
        let renderedHtml = htmlTemplateIndex
        let blogs = loadLatestBlogs(lang)
        console.log(blogs)
        let blogContent = ''

        if (blogs === null || blogs.length === 0) {
            renderedHtml = renderedHtml.replace('{{BLOGS_SECTION_DISPLAY}}', 'hidden')
            renderedHtml = renderedHtml.replace('{{BLOGS_TEMPLATE}}', '')
        } else {
            renderedHtml = renderedHtml.replace('{{BLOGS_SECTION_DISPLAY}}', 'block')
            blogs.forEach(blog => {
                blogContent += `
                <div
                    class="bg-white rounded-2xl overflow-hidden border border-stone-200/80 shadow-sm flex flex-col justify-between">
                    <div class="zoom-hover h-[240px] overflow-hidden">
                        <img class="w-full h-full object-cover"
                            src="${blog.title_img}"
                            >
                    </div>
                    <div class="p-6 md:p-8 flex-grow flex flex-col justify-between">
                        <div>
                            <h3 class="font-serif text-xl font-bold text-primary-green mb-3">${blog.title}
                            </h3>
                        </div>
                        <a href="{{lang_prefix}}/blog/${blog.blogid}"
                            class="inline-block border border-earth-brown hover:bg-earth-brown hover:text-white text-earth-brown font-bold text-xs tracking-wider uppercase text-center py-3.5 rounded-lg transition duration-300">{{blog_read_cta}}</a>
                    </div>
                </div>`
            })
        }

        renderedHtml = renderedHtml.replace('{{BLOGS_TEMPLATE}}', blogContent)

        const langPrefix = lang === 'en' ? '' : `/${lang}`;
        renderedHtml = renderedHtml.replace(/{{lang_prefix}}/g, langPrefix);


        let faqSchema = [];
        if (t.faq_data) {
            Object.values(t.faq_data).forEach(letterArray => {
                if (Array.isArray(letterArray)) {
                    letterArray.forEach(item => {
                        faqSchema.push({
                            "@type": "Question",
                            "name": item.question,
                            "acceptedAnswer": {
                                "@type": "Answer",
                                "text": item.answer
                            }
                        });
                    });
                }
            });
        }
        renderedHtml = renderedHtml.replace('{{FAQ_SCHEMA_JSON}}', JSON.stringify(faqSchema, null, 2));

        Object.keys(t).forEach(key => {

            const regex = new RegExp(`{{${key}}}`, 'g');
            renderedHtml = renderedHtml.replace(regex, t[key]);
        })
        res.send(renderedHtml)
    }


    function renderBook(res, lang) {
        const t = languages[lang] || languages['en']
        let renderedHtml = htmlTemplateBook

        const langPrefix = lang === 'en' ? '' : `/${lang}`;
        renderedHtml = renderedHtml.replace(/{{lang_prefix}}/g, langPrefix);


        Object.keys(t).forEach(key => {

            const regex = new RegExp(`{{${key}}}`, 'g');
            renderedHtml = renderedHtml.replace(regex, t[key]);
        })
        res.send(renderedHtml)

    }

    function renderFaq(res, lang) {
        const t = languages[lang] || languages['en']
        let renderedHtml = htmlTemplateFaq

        const langPrefix = lang === 'en' ? '' : `/${lang}`;
        renderedHtml = renderedHtml.replace(/{{lang_prefix}}/g, langPrefix);


        let faqItems = [];
        if (t.faq_data) {
            // Flatten the structure in case translators leave them in the wrong letter object
            Object.values(t.faq_data).forEach(letterArray => {
                if (Array.isArray(letterArray)) {
                    letterArray.forEach(item => {
                        faqItems.push(item);
                    });
                }
            });
        }

        faqItems.sort((a, b) => a.keyword.localeCompare(b.keyword, lang));

        let groups = {};
        faqItems.forEach(item => {
            let letter = item.keyword.charAt(0).toUpperCase();
            if (!groups[letter]) groups[letter] = [];
            groups[letter].push(item);
        });

        let dynamicHtml = '';
        let sortedLetters = Object.keys(groups).sort((a, b) => a.localeCompare(b, lang));

        sortedLetters.forEach(letter => {
            dynamicHtml += `
            <div class="faq-letter-group" data-letter="${letter}">
                <div class="text-sm font-bold text-earth-brown tracking-widest border-b border-stone-100 pb-1 mb-4">${letter}</div>`;

            groups[letter].forEach(faq => {
                let categoryAttr = faq.category ? ` data-category="${faq.category}"` : '';
                dynamicHtml += `
                <sl-details class="shadow-sm"${categoryAttr} summary="${faq.keyword} — ${faq.question}">
                    ${faq.answer}
                </sl-details>`;
            });

            dynamicHtml += `</div>\n`;
        });

        renderedHtml = renderedHtml.replace('{{FAQ_DYNAMIC_CONTENT}}', dynamicHtml);

        Object.keys(t).forEach(key => {
            const regex = new RegExp(`{{${key}}}`, 'g');
            renderedHtml = renderedHtml.replace(regex, t[key]);
        });
        res.send(renderedHtml);
    }

    function renderAmenities(res, lang) {
        const t = languages[lang] || languages['en']
        let renderedHtml = htmlTemplateAmenities

        const langPrefix = lang === 'en' ? '' : `/${lang}`;
        renderedHtml = renderedHtml.replace(/{{lang_prefix}}/g, langPrefix);


        Object.keys(t).forEach(key => {
            if (typeof t[key] === 'string') {
                const regex = new RegExp(`{{${key}}}`, 'g');
                renderedHtml = renderedHtml.replace(regex, t[key]);
            }
        });
        res.send(renderedHtml);
    }

    function renderNotice(res, lang) {
        const t = languages[lang] || languages['en']
        let renderedHtml = htmlTemplateNotice

        const langPrefix = lang === 'en' ? '' : `/${lang}`;
        renderedHtml = renderedHtml.replace(/{{lang_prefix}}/g, langPrefix);


        Object.keys(t).forEach(key => {
            if (typeof t[key] === 'string') {
                const regex = new RegExp(`{{${key}}}`, 'g');
                renderedHtml = renderedHtml.replace(regex, t[key]);
            }
        });
        res.send(renderedHtml);
    }

    function renderBlog(res, lang, id) {
        const t = languages[lang] || languages['en']


        const filePath = path.join(__dirname, 'public/blogs', `${id}.json`)
        try {
            if (!fs.existsSync(filePath)) {
                return res.status(404).send('Blog not found')
            }

            const blog = JSON.parse(fs.readFileSync(filePath, 'utf8'))

            let renderedHtml = htmlTemplateBlog
            const metaKey = `${lang}_meta`
            const seo = blog[metaKey] || blog.en_meta || {}

            const metaTitle = seo.title || blog.title || 'Untitled'
            const metaDesc = seo.desc || ''
            const metaKeywords = seo.keywords || ''
            const ogImage = blog.title_img ? `https://www.kozarapanoramicresort.ba${blog.title_img}` : ''
            const canonicalUrl = `https://www.kozarapanoramicresort.ba/${lang}/blog/${id}`
            const altText = seo.img_alt

            let contentHtml = blog.editor.replace(/<img([^>]+)>/, `<img alt="${altText}" $1`)

            const schemaData = {
                "@context": "https://schema.org",
                "@type": 'BlogPosting',
                "headline": metaTitle,
                "image": [ogImage],
                "author": { "@type": "Organization", "name": "Kozara Panoramic Resort" },
                "publisher": {
                    "@type": "Organization",
                    "name": "Kozara Panoramic Resort",
                    "logo": { "@type": "ImageObject", "url": "https://kozarapanoramicresort.ba/assets/logo_stripped.svg" }
                },
                "description": metaDesc
            }

            renderedHtml = renderedHtml.replace('<html lang="en" class="sl-theme-light">', `<html lang="${lang}" class="sl-theme-light">`);





            Object.keys(t).forEach(key => {

                const regex = new RegExp(`{{${key}}}`, 'g');
                renderedHtml = renderedHtml.replace(regex, t[key]);
            })

            renderedHtml = renderedHtml.replace(/\{\{BLOG_TITLE_META\}\}/g, metaTitle);
            renderedHtml = renderedHtml.replace(/\{\{META_DESCRIPTION\}\}/g, metaDesc);
            renderedHtml = renderedHtml.replace(/\{\{META_KEYWORDS\}\}/g, metaKeywords);
            renderedHtml = renderedHtml.replace(/\{\{BLOG_SLUG\}\}/g, id); // Using ID as slug
            renderedHtml = renderedHtml.replace(/\{\{OG_IMAGE\}\}/g, blog.title_img || '');
            renderedHtml = renderedHtml.replace('{{SCHEMA_JSON_LD}}', `<script type="application/ld+json">${JSON.stringify(schemaData)}</script>`);

            renderedHtml = renderedHtml.replace('{{BLOG_CONTENT}}', contentHtml || 'Untitled');
            renderedHtml = renderedHtml.replace(/\{\{BLOG_ID\}\}/g, id);

            const langPrefix = lang === 'en' ? '' : `/${lang}`;
            renderedHtml = renderedHtml.replace(/\{\{lang_prefix\}\}/g, langPrefix);

            res.send(renderedHtml)

        } catch (error) {
            logger.error(error)

        }
    }

    return {
        renderIndex,
        renderBook,
        renderFaq,
        renderAmenities,
        renderNotice,
        renderBlog
    }
}
