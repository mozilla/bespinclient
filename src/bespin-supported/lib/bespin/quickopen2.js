
window.FS = SC.Object.create({
    store: SC.Store.create()
});

FS.Project = SC.Object.extend({
   contents: null,
   name: "",
   rootDirectory: null,

   init: function() {
       this.set('contents', []);
   }
});

FS.File = SC.Object.extend({
   name: "",

   // MIME-type, perhaps?
   type: "",

   directory: null
});

FS.Directory = SC.Object.extend({
    path: "",
    contents: null,

    init: function() {
        this.set('contents', []);
    },

    _fileAdded: function(length) {
        var contents = this.get('contents'),
            lastItem = contents.objectAt(length - 1);

        lastItem.set('directory', this);
    }.observes('contents.[]')
});

window.QuickOpen = {};

QuickOpen.controller = SC.Object.create({
   project: null,

   searchKey: "",

   matchingFiles: function() {
       var project = this.get('project');
       if (!project) {
        return [];
    }

       var rootDir = project.get('rootDirectory');
       var results = [], searchKey =
        (this.get('searchKey') || "").toLowerCase();

       function traverse(directory, results, searchKey) {
           var contents = directory.get('contents');
           for (var i = 0, file, name; i < contents.get('length'); i++) {
               file = contents.objectAt(i);
               if (SC.instanceOf(FS.Directory)) {
                   traverse(file, results, searchKey);
               } else {
                    // Check against the search key
                    name = file.get('name');
                    if (name.toLowerCase().indexOf(searchKey) > -1) {
                        results.pushObject(file);
                    }
               }
           }
       }

       traverse(rootDir, results, searchKey);
       return results;
   }.property('searchKey', 'project').cacheable()
});

// Fixtures

var dir1 = FS.Directory.create({
    path: '/Users/andrew/Code/foo'
});

var file1 = FS.File.create({
   name: 'foo.txt',
   type: 'text/plain',
   directory: dir1
});

dir1.get('contents').pushObject(file1);

var project1 = FS.Project.create({
    name: 'Sample Project',
    rootDirectory: dir1
});

QuickOpen.controller.set('project', project1);

window.project1 = project1;
window.dir1 = dir1;
window.file1 = file1;

console.log("about to call SC._didBecomeReady");
SC._didBecomeReady();
console.log("done!");

var FileView = SC.ListItemView.extend({
    init: function() {
        console.log("init");
        window._fv = this;
    },
    contentValueKey: function() {
        console.log("retrieving contentValueKey");
        return 'name';
    }.property()
});

var mainPage = SC.Page.design({
    mainPane: SC.MainPane.design({
        childViews: 'modal'.w(),

        modal: SC.View.design({
            classNames: ['bespin-modal'],
            backgroundColor: 'white',

            childViews: 'searchField fileList'.w(),

            layout: { width: 400, height: 200, centerX: 0, centerY: 0 },

            searchField: SC.TextFieldView.design({
                layout: { left: 10, right: 10, top: 10, height: 20 },
                fieldValueBinding: 'QuickOpen.controller.searchKey'
            }),

            fileList: SC.ListView.design({
                layout: { top: 40, left: 10, right: 10, bottom: 10 },
                contentValueKey: 'name',

                contentBinding: 'QuickOpen.controller.matchingFiles',
                exampleView: FileView
            })
        })
    })
});

mainPage.get('mainPane').append();

// var list = SC.ListView.create({
//    layout: { }
// });